(function() {
	
	require('events').EventEmitter.prototype._maxListeners = 100;
	
	var express = require('express');
	var bodyParser = require('body-parser');
	var async = require('async');
	var fs = require('fs');
	var wav = require('wav');
	var math = require('mathjs');
	var util = require('./util.js');
	var audio = require('./audio.js');
	var analyzer = require('./analyzer.js');
	var net = require('./net.js');
	var kmeans = require('./kmeans.js');
	
	var app = express();
	
	app.use(express["static"](__dirname + '/app'));
	app.use(bodyParser.raw({ type: 'audio/wav', limit: '50mb' }));
	
	var audioFolder = 'recordings/';
	var currentFileCount = 0;
	var numClusters;
	var fragmentLength, fadeLength;
	var filename = 'ligeti1.wav';
	
	var fragments = [];
	var clustering, lstm;
	var isSampling = false;
	
	var randomElementIndices, currentWavSequence;
	
	init();
	
	function init() {
		fs.readdir(audioFolder, function(err, files) {
			files = files.filter(function(f){return f.indexOf('.wav') > 0;})
				.sort(function(f,g){return parseInt(f.slice(0,-4)) - parseInt(g.slice(0,-4));});
			currentFileCount = Math.max.apply(Math, files.map(function(f){return parseInt(f.slice(0,-4))}));
			async.eachSeries(files, loadIntoMemory, function(){
				clusterCurrentMemory();
				console.log("memory loaded and clustered");
			});
		});
	}
	
	app.post('/postAudioBlob', function (request, response) {
		var filename = currentFileCount.toString()+'.wav';
		currentFileCount++;
		var writer = new wav.FileWriter(audioFolder+filename);
		writer.write(request.body);
		writer.end();
		setTimeout(function(){
			postProcess(audioFolder+filename, function() {
				response.send('wav saved at ' + filename);
				analyzeAndUpdateMemory(filename, function() {
				});
			});
		}, 50);
	});
	
	function postProcess(path, callback) {
		var tempPath = path.slice(0, path.indexOf('.wav'))+'_'+'.wav';
		//get rid of initial click from coming from recorderjs
		util.execute('sox '+path+' '+tempPath+' trim 0.003', function(success) {
			if (success) {
				util.execute('mv '+tempPath+' '+path, function(success) {
					callback();
				});
			}
		});
	}
	
	function analyzeAndUpdateMemory(filename, callback) {
		analyzer.extractFeatures(audioFolder+filename, function(){
			loadIntoMemory(filename, function() {
				clusterCurrentMemory();
				callback();
			});
		});
	}
	
	function loadIntoMemory(filename, callback) {
		console.log(filename)
		audio.init(filename, audioFolder, function(){
			fragments = fragments.concat(analyzer.getFragmentsAndSummarizedFeatures(filename, fragmentLength));
			callback();
		});
	}
	
	function clusterCurrentMemory() {
		var vectors = fragments.map(function(f){return f["vector"];});
		clustering = new kmeans.Clustering(vectors, numClusters);
	}
	
	app.get('/getCurrentStatus', function(request, response, next) {
		response.write(JSON.stringify({fragments:fragments, numclusters:clustering.getClusters().length, currentFragmentIndex:randomElementIndices?randomElementIndices[0]:-1}));
		response.end();
	});
	
	app.get('/getNextFragment', function(request, response, next) {
		var newFadeLength = setFadeLength(parseFloat(request.query.fadelength));
		var newFragmentLength = setFragmentLength(parseFloat(request.query.fragmentlength));
		//make new fragments if list empty or parameters changed
		if (newFadeLength || newFragmentLength || !currentWavSequence || currentWavSequence.length == 0) {
			//setupTest(filename, function() {
				currentCharSequence = clustering.getCharSequence();
				currentWavSequence = charsToWavList(currentCharSequence);
				pushNextFragment(response);
			//});
		} else {
			pushNextFragment(response);
		}
	});
	
	function setFadeLength(newFadeLength) {
		if (!isNaN(newFadeLength) && newFadeLength != fadeLength) {
			fadeLength = newFadeLength;
			return true;
		}
	}
	
	function setFragmentLength(newFragmentLength) {
		if (!isNaN(newFragmentLength) && newFragmentLength != fragmentLength) {
			fragmentLength = newFragmentLength;
			return true;
		}
	}
	
	function pushNextFragment(sink) {
		var writer = new wav.Writer();
		writer.pipe(sink);
		writer.push(currentWavSequence.shift());
		randomElementIndices.shift();
		writer.end();
	}
	
	//analyzer.extractFeatures(audioFolder+filename, [features.onset, features.amp, features.centroid, features.mfcc, features.chroma]);
	//test();
	//testIterativeClustering();
	
	function test() {
		setupTest(filename, function() {
			testOriginalSequence();
		});
	}
	
	function testClusters() {
		var clusters = clustering.getClusters();
		var i = 0;
		async.eachSeries(clusters, function(cluster, callback) {
			var wav = indicesToWav(cluster);
			var duration = wav.length/44100/2/2;
			console.log("playing cluster " + i + " with size " + cluster.length + " and duration " + duration);
			audio.play(wav, true);
			i++;
			setTimeout(callback, (1000*duration)-50);
		}, function(err) {
			audio.end();
			console.log(err);
		});
	}
	
	function testOriginalSequence() {
		var chars = clustering.getCharSequence();
		console.log(chars)
		audio.play(charsToWav(chars));
	}
	
	function testSamplingTheNet() {
		//create list of sentences of 50 chars
		var charSentences = clustering.getCharSequence().match(/.{1,50}/g);
		lstm = new net.Lstm(charSentences);
		lstm.learn();
		startSampling();
	}
	
	function setupTest(filename, callback) {
		audio.init(filename, audioFolder, function(){
			fragments = analyzer.getFragmentsAndSummarizedFeatures(filename, fragmentLength);
			var vectors = fragments.map(function(f){return f["vector"];});
			clustering = new kmeans.Clustering(vectors, numClusters);
			callback();
		});
	}
	
	function testIterativeClustering() {
		audio.init(filename, audioFolder, function(){
			fragments = analyzer.getFragmentsAndSummarizedFeatures(filename, fragmentLength);
			var vectors = fragments.map(function(f){return f["vector"];});
			var groupSize = vectors.length / 10;
			var clusterings = [];
			for (var i = 0; i < 10; i++) {
				var currentGroup = vectors.slice(0, (i+1)*groupSize);
				clusterings.push(new kmeans.Clustering(currentGroup));
				if (i > 0) {
					var iM = getIntersectionMatrix(clusterings[i-1].getClusters(), clusterings[i].getClusters());
					console.log(getClusterRelationships(iM, false));
					
					var dM = getDistanceMatrix(clusterings[i-1].getCentroids(), clusterings[i].getCentroids());
					console.log(getClusterRelationships(dM, true));
				}
			}
		});
	}
	
	function getClusterRelationships(matrix, ascending) {
		var elements = getOrderedElements(matrix, ascending);
		var oldNew = [];
		var i = 0;
		while (Object.keys(oldNew).length < matrix.length) {
			var currentPair = elements[i].coords;
			var currentKeys = Object.keys(oldNew);
			var currentValues = currentKeys.map(function(k){return oldNew[k];});
			if (currentKeys.indexOf(currentPair[0].toString()) < 0 && currentValues.indexOf(currentPair[1]) < 0) {
				oldNew[currentPair[0]] = currentPair[1];
			}
			i++;
		}
		return oldNew;
	}
	
	function getOrderedElements(matrix, ascending) {
		var orderedElements = [];
		for (var i = 0; i < matrix.length; i++) {
			for (var j = 0; j < matrix[i].length; j++) {
				orderedElements.push({value:matrix[i][j], coords:[i,j]});
			}
		}
		if (ascending) {
			orderedElements.sort(function(a, b) {return a.value - b.value;});
		} else {
			orderedElements.sort(function(a, b) {return b.value - a.value;});
		}
		return orderedElements;
	}
	
	function getIntersectionMatrix(a, b) {
		var intersections = [];
		for (var i = 0; i < a.length; i++) {
			var currentCol = [];
			for (var j = 0; j < b.length; j++) {
				currentCol.push(getIntersection(a[i], b[j]).length);
			}
			intersections.push(currentCol);
		}
		return intersections;
	}
	
	function getIntersection(a, b) {
		var t;
		if (b.length > a.length) t = b, b = a, a = t; // indexOf to loop over shorter
		return a.filter(function (e) {
			if (b.indexOf(e) !== -1) return true;
		});
	}
	
	function getDistanceMatrix(a, b) {
		var distances = [];
		for (var i = 0; i < a.length; i++) {
			var currentCol = [];
			for (var j = 0; j < b.length; j++) {
				currentCol.push(getEuclideanDistance(a[i], b[j]));
			}
			distances.push(currentCol);
		}
		return distances;
	}
	
	function getEuclideanDistance(a, b) {
		var lim = Math.min(a.length, b.length);
		var dist = 0;
		for (var i = 0; i < lim; i++) {
			dist += Math.pow(a[i]-b[i], 2);
		}
		return Math.sqrt(dist);
	}
	
	
	
	function startSampling() {
		isSampling = true;
		samplingLoop();
	}
	
	function samplingLoop() {
		if (isSampling) {
			var sample = lstm.sample();
			charsToWav(sample, function(wav){
				audio.play(wav, true);
				//TODO CALCULATE AS BELOW
				var duration = wav.length/44100/2/2;
				console.log(sample, duration);
				setTimeout(function() {
					samplingLoop();
				}, (1000*duration)-100);
			});
		}
	}
	
	function stopSampling() {
		isSampling = false;
		audio.end();
	}
	
	function charsToWavList(chars) {
		randomElementIndices = Array.prototype.map.call(chars, function(c){return clustering.getRandomClusterElement(c);});
		return audio.fragmentsToWavList(randomElementIndices.map(function(i){return fragments[i];}), fadeLength);
	}
	
	function charsToWav(chars) {
		var randomElementIndices = Array.prototype.map.call(chars, function(c){return clustering.getRandomClusterElement(c);});
		return indicesToWav(randomElementIndices);
	}
	
	function indicesToWav(fragmentIndices) {
		return audio.fragmentsToWav(fragmentIndices.map(function(i){return fragments[i];}), fadeLength);
	}
	
	app.listen("8088");
	
	console.log('Server started at http://localhost:8088');
	
}).call(this);
