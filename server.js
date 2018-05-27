(function() {

	var self = this;

	require('events').EventEmitter.prototype._maxListeners = 300;

	var express = require('express');
	var bodyParser = require('body-parser');
	var async = require('async');
	var _ = require('lodash');
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
	var CLUSTER_PROPORTION = 0.03;
	var fragmentLength //= 0.1;
	var FADE_LENGTH = 0.01;

	var fragments = [];
	var clustering = new kmeans.Clustering(self);
	var brain;
	var previousSample;

	var LOAD = {AT_ONCE:"AT_ONCE", GRADUALLY:"GRADUALLY"};
	var loading = LOAD.GRADUALLY;
	var MODES = {NET:"NET", SEQUENCE:"SEQUENCE", CLUSTERS:"CLUSTERS"};
	var currentMode = MODES.NET;

	var MAX_NUM_FRAGMENTS = 5000;
	var FORGET = {BEGINNING:"BEGINNING", RANDOM:"RANDOM", CLUSTERS:"CLUSTERS"};
	var forgetting = FORGET.RANDOM;
	var MARKOV_ORDER = 4;

	var currentIndexSequence;

	init();
	//test();

	function init() {
		if (loading == LOAD.GRADUALLY) {
			loadGradually();
		} else {
			loadAtOnce();
		}
	}

	function loadAtOnce() {
		fs.readdir(audioFolder, function(err, files) {
			files = files.filter(function(f){return f.indexOf('.wav') > 0;})
				.sort(function(f,g){return parseInt(f.slice(0,-4)) - parseInt(g.slice(0,-4));});
			if (files.length > 0) {
				currentFileCount = files.length;
				async.eachSeries(files, analyzeAndLoad, function(){ //loadIntoMemory analyzeAndLoad
					var numForgotten = forget();
					if (numForgotten) {
						self.emitInfo("forgot "+ numForgotten + " fragments")
					}
					clusterCurrentMemory();
					emitFragments();
					updateBrain();
					self.emitInfo("memory loaded and clustered");
					//testSamplingTheNet();
					//test();
				});
			}
		});
	}

	function loadGradually() {
		fs.readdir(audioFolder, function(err, files) {
			files = files.filter(function(f){return f.indexOf('.wav') > 0;})
				.sort(function(f,g){return parseInt(f.slice(0,-4)) - parseInt(g.slice(0,-4));});
			if (files.length > 0) {
				async.eachSeries(files, (filename, callback) => {
					analyzeAndLoad(filename, () => {
						var forgottenFragments = forget();
						if (forgottenFragments) {
							self.emitInfo("forgot "+ forgottenFragments + " fragments")
						}
						clusterCurrentMemory();
						updateBrain();
						emitFragments();
						self.emitInfo(filename, "loaded and clustered");
						setTimeout(callback, 10000); //one file every 10 secs
					});
				})
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
					var forgottenFragments = forget();
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
		console.log("analyzing", filename)
		analyzer.extractFeatures(audioFolder+filename, function(){
			loadIntoMemory(filename, function() {
				callback();
			});
		});
	}

	function forget() {
		if (fragments.length > MAX_NUM_FRAGMENTS) {
			var forgotNumFragments = fragments.length-MAX_NUM_FRAGMENTS;
			if (forgetting == FORGET.BEGINNING) {
				fragments = fragments.slice(forgotNumFragments);
			} else {
				fragments = _.sampleSize(fragments, MAX_NUM_FRAGMENTS);
			}
			return forgotNumFragments;
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
		let nextIndex = currentIndexSequence.shift();
		var nextFragment = fragments[nextIndex];
		var format = audio.getFormat(nextFragment);
		var writer = new wav.Writer(format);
		writer.pipe(sink);
		writer.push(audio.fragmentToWav(nextFragment, FADE_LENGTH));
		writer.end();
	}

	function updateBrain() {
		charSentences = [clustering.getCharSequence()]
		console.log(charSentences)
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
		let indexList = charsToIndexList(sample);
		return indexList;
	}

	function charsToIndexList(chars) {
		return chars.split('').map(c => clustering.getRandomClusterElement(c));
		//return audio.fragmentsToWavList(currentIndexSequence.map(function(i){return fragments[i];}), FADE_LENGTH);
	}

	function charsToWav(chars) {
		return indicesToWav(charsToIndexList(chars));
		//return indicesToWav(currentIndexSequence);
	}

	function indicesToWavList(fragmentIndices) {
		currentIndexSequence = fragmentIndices;
		//return audio.fragmentsToWavList(fragmentIndices.map(function(i){return fragments[i];}), FADE_LENGTH);
	}

	function indicesToWav(fragmentIndices) {
		return fragmentIndices.map(i => audio.fragmentToWav(fragments[i]));
		//return audio.fragmentsToWav(fragmentIndices.map(i => fragments[i]), FADE_LENGTH);
	}




	////// TESTS

	function test() {
		//setupTest("Buddy Holly - It Doesn't Matter Anymore.wav", function() {
			//testOriginalSequence();
			testClusters();
		//});
	}

	function testClusters() {
		var clusters = clustering.getClusters();
		var i = 0;
		async.eachSeries(clusters, function(cluster, callback) {
			var wav = indicesToWav(cluster);
			var duration = wav.join().length/44100/2/2;
			self.emitInfo("playing cluster " + i + " with size " + cluster.length + " and duration " + duration);
			wav.forEach(w => audio.play(w, true));
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
		//console.log(charsToWav(chars))
		charsToWav(chars).forEach((w,i) => audio.play(w, i < chars.length-1));
		//audio.play(charsToWav(chars));
	}

	function testSampling() {
		let sequence = this.getBrainSample();
	}

	function setupTest(filename, callback) {
		audio.init(filename, audioFolder, function(){
			fragments = analyzer.getFragmentsAndSummarizedFeatures(filename, fragmentLength);
			//console.log(fragments.map(f => [f.time, f.duration, f.vector[1]]).slice(0,30))
			var vectors = fragments.map(f => f["vector"]);
			clustering.cluster(vectors, CLUSTER_PROPORTION);
			callback();
		});
	}

}).call(this);
