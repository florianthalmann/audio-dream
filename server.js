(function() {

	var self = this;

	require('events').EventEmitter.prototype._maxListeners = 300;

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
	var MarkovChain = require('./lib/markov.js').MarkovChain;

	var app = express();
	app.use(express["static"](__dirname + '/app'));
	app.use(bodyParser.raw({ type: 'audio/wav', limit: '50mb' }));
	var server = app.listen(8088);
	var io = require('socket.io')(server);
	var socket;
	console.log('Server started at http://localhost:8088');

	var audioFolder = 'recordings/';
	var currentFileCount = 0;
	var CLUSTER_PROPORTION = 0.05;
	var fragmentLength = 0.03;
	var FADE_LENGTH = 0.5;

	var fragments = [];
	var clustering = new kmeans.Clustering(self);
	var brain;
	var previousSample;

	var MODES = {NET:"NET", SEQUENCE:"SEQUENCE", CLUSTERS:"CLUSTERS"};
	var currentMode = MODES.NET;

	var MAX_NUM_FRAGMENTS;// = 3000;
	var MARKOV_ORDER = 4;

	var currentIndexSequence;

	init();
	//test();

	function init() {
		fs.readdir(audioFolder, function(err, files) {
			files = files.filter(function(f){return f.indexOf('.wav') > 0;})
				.sort(function(f,g){return parseInt(f.slice(0,-4)) - parseInt(g.slice(0,-4));});
			if (files.length > 0) {
				currentFileCount = Math.max.apply(Math, files.map(function(f){return parseInt(f.slice(0,-4))}));
				async.eachSeries(files, analyzeAndLoad, function(){ //loadIntoMemory analyzeAndLoad
					forgetBeginning();
					clusterCurrentMemory();
					emitFragments();
					updateBrain();
					self.emitInfo("memory loaded and clustered");
					//testSamplingTheNet();
				});
			}
		});
	}

	function clearMemory() {
		fs.readdir(audioFolder, function(err, files) {
			files = files.filter(function(f){return f.indexOf('.wav') > 0;});
			files.forEach(function(file){
				fs.unlinkSync(audioFolder+file);
			});
			fragments = [];
			emitFragments();
			currentFileCount = 0;
			currentIndexSequence = null;
			clustering = new kmeans.Clustering(self);
			self.emitInfo("forgot absolutely everything");
		});
	}

	io.on('connection', function (s) {
		socket = s;
		emitFragments();
		//emitParamValues();
		socket.on('changeFadeLength', function(data) {
			FADE_LENGTH = data.value;
			console.log("FADE_LENGTH changed to "+data.value);
		});
		socket.on('changeMaxNumFragments', function(data) {
			MAX_NUM_FRAGMENTS = data.value;
			console.log("MAX_NUM_FRAGMENTS changed to "+data.value);
		});
		socket.on('changeClusterProportion', function(data) {
			CLUSTER_PROPORTION = data.value;
			console.log("CLUSTER_PROPORTION changed to "+data.value);
		});
		socket.on('clearMemory', function() {
			clearMemory();
		});
	});

	this.emitInfo = function(text) {
		console.log(text);
		if (socket) {
			socket.emit('aiOutput', { text:text });
		}
	}

	function emitFragments() {
		if (socket) {
			var numClusters = clustering.getClusters() ? clustering.getClusters().length : 0;
			socket.emit('fragments', { fragments:fragments, numClusters:numClusters });
		}
	}

	function emitNextFragmentIndex() {
		if (socket) {
			var nextFragmentIndex = currentIndexSequence?currentIndexSequence[0]:-1;
			socket.emit('nextFragmentIndex', { nextFragmentIndex:nextFragmentIndex });
		}
	}

	app.get('/getSampleList', function(request, response, next) {
		fs.readdir('app/samples/', function(err, files) {
			files = files.filter(function(f){return f.indexOf('.wav') > 0 || f.indexOf('.Wav') > 0 || f.indexOf('.aif') > 0;})
				.sort(function(f,g){return parseInt(f.slice(0,-4)) - parseInt(g.slice(0,-4));});
			response.send(JSON.stringify(files));
		});
	});

	app.post('/postAudioBlob', function (request, response) {
		var filename = currentFileCount.toString()+'.wav';
		currentFileCount++;
		var writer = new wav.FileWriter(audioFolder+filename);
		writer.write(request.body);
		writer.end();
		setTimeout(function(){
			postProcess(audioFolder+filename, function() {
				response.send('wav saved at ' + filename);
				analyzeAndLoad(filename, function() {
					var forgottenFragments = forgetBeginning();
					if (forgottenFragments) {
						self.emitInfo("forgot "+ forgottenFragments + " fragments")
					}
					clusterCurrentMemory();
					updateBrain();
					emitFragments();
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

	function analyzeAndLoad(filename, callback) {
		analyzer.extractFeatures(audioFolder+filename, function(){
			loadIntoMemory(filename, function() {
				callback();
			});
		});
	}

	function forgetBeginning() {
		if (fragments.length > MAX_NUM_FRAGMENTS) {
			forgottenFragments = fragments.length-MAX_NUM_FRAGMENTS;
			fragments = fragments.slice(forgottenFragments);
			return forgottenFragments;
		}
		return 0;
	}

	function loadIntoMemoryAndCluster(filename, callback) {
		loadIntoMemory(filename, function() {
			clusterCurrentMemory();
			emitFragments();
			setTimeout(function() {
				callback();
			}, 2000);
		})
	}

	function loadIntoMemory(filename, callback) {
		audio.init(filename, audioFolder, function(){
			fragments = fragments.concat(analyzer.getFragmentsAndSummarizedFeatures(filename, fragmentLength));
			console.log("num fragments", fragments.length)
			callback();
		});
	}

	function clusterCurrentMemory() {
		var vectors = fragments.map(function(f){return f["vector"];});
		clustering.cluster(vectors, CLUSTER_PROPORTION);
		//annotate fragments
		var indexSequence = clustering.getIndexSequence();
		for (var i = 0; i < fragments.length; i++) {
			fragments[i]["clusterIndex"] = indexSequence[i];
		}
	}

	app.get('/getNextFragment', function(request, response, next) {
		//make new fragments if list empty or parameters changed
		if (!currentIndexSequence || currentIndexSequence.length == 0) {
			if (currentMode == MODES.NET && brain) {
				currentIndexSequence = getBrainSample();
			} else if (currentMode == MODES.CLUSTERS) {
				currentIndexSequence = clustering.getClusterSequence();
			} else {
				currentIndexSequence = charsToIndexList(clustering.getCharSequence());
			}
			pushNextFragment(response);
		} else {
			pushNextFragment(response);
		}
	});

	function pushNextFragment(sink) {
		emitNextFragmentIndex();
		var nextFragment = fragments[currentIndexSequence.shift()];
		var format = audio.getFormat(nextFragment);
		var writer = new wav.Writer(format);
		writer.pipe(sink);
		writer.push(audio.fragmentToWav(nextFragment, FADE_LENGTH));
		writer.end();
	}

	function updateBrain() {
		charSentences = [clustering.getCharSequence()]
		if (!brain) {
			initMarkovChain();
		} else {
			brain.replaceSentences(charSentences);
		}
	}

	function initLstm() {
		brain = new net.Lstm(charSentences, self);
		brain.learn();
	}

	function initMarkovChain() {
		brain = new MarkovChain(charSentences, MARKOV_ORDER);
	}

	function getBrainSample() {
		var sample = brain.sample(previousSample);
		sample = clustering.toValidCharSequence(sample);
		previousSample = sample;
		self.emitInfo("sampled neural network: "+sample);
		return charsToIndexList(sample);
	}

	function charsToIndexList(chars) {
		return Array.prototype.map.call(chars, function(c){return clustering.getRandomClusterElement(c);});
		//return audio.fragmentsToWavList(currentIndexSequence.map(function(i){return fragments[i];}), FADE_LENGTH);
	}

	/*function charsToWav(chars) {
		return Array.prototype.map.call(chars, function(c){return clustering.getRandomClusterElement(c);});
		//return indicesToWav(currentIndexSequence);
	}

	function indicesToWavList(fragmentIndices) {
		currentIndexSequence = fragmentIndices;
		//return audio.fragmentsToWavList(fragmentIndices.map(function(i){return fragments[i];}), FADE_LENGTH);
	}

	function indicesToWav(fragmentIndices) {
		return audio.fragmentsToWav(fragmentIndices.map(function(i){return fragments[i];}), FADE_LENGTH);
	}*/




	////// TESTS

	function test() {
		setupTest('ligeti.wav', function() {
			testOriginalSequence();
		});
	}

	function testClusters() {
		var clusters = clustering.getClusters();
		var i = 0;
		async.eachSeries(clusters, function(cluster, callback) {
			var wav = indicesToWav(cluster);
			var duration = wav.length/44100/2/2;
			self.emitInfo("playing cluster " + i + " with size " + cluster.length + " and duration " + duration);
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

	function setupTest(filename, callback) {
		audio.init(filename, audioFolder, function(){
			fragments = analyzer.getFragmentsAndSummarizedFeatures(filename, fragmentLength);
			var vectors = fragments.map(function(f){return f["vector"];});
			clustering.cluster(vectors, CLUSTER_PROPORTION);
			callback();
		});
	}

}).call(this);
