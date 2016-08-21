(function() {
	
	var express = require('express');
	var bodyParser = require('body-parser');
	var util = require('./util.js');
	var audio = require('./audio.js');
	var analyzer = require('./analyzer.js');
	var net = require('./net.js');
	var kmeans = require('./kmeans.js');
	
	var app = express();
	
	app.use(express["static"](__dirname + '/app'));
	app.use(bodyParser.raw({ type: 'audio/wav', limit: '50mb' }));
	
	var features = {onset:'vamp:qm-vamp-plugins:qm-onsetdetector:onsets', amp:'vamp:vamp-example-plugins:amplitudefollower:amplitude', chroma:'vamp:qm-vamp-plugins:qm-chromagram:chromagram', centroid:'vamp:vamp-example-plugins:spectralcentroid:logcentroid', mfcc:'vamp:qm-vamp-plugins:qm-mfcc:coefficients', melody:'vamp:mtg-melodia:melodia:melody'};
	
	var currentFileCount = 0;
	var numClusters = 50;
	var useSegmentation = true;
	var filename = 'ligeti1.wav';
	
	var fragments, clustering, lstm;
	var isSampling = false;
	
	app.post('/postAudioBlob', function (request, response) {
		var currentPath = audioFolder+currentFileCount.toString()+'.wav';
		currentFileCount++;
		var writer = new wav.FileWriter(currentPath);
		writer.write(request.body);
		writer.end();
		postProcess(currentPath);
		response.send('wav saved at ' + currentPath);
	});
	
	function postProcess(path) {
		var tempPath = path.slice(0, path.indexOf('.wav'))+'_'+'.wav';
		//get rid of initial click from coming from recorderjs
		util.execute('sox '+path+' '+tempPath+' trim 0.003', function(success) {
			if (success) {
				util.execute('mv '+tempPath+' '+path);
			}
		});
	}
	
	//analyzer.extractFeatures(audioFolder+filename, [features.onset, features.amp, features.centroid, features.mfcc, features.chroma]);
	test();
	
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
		//console.log(chars)
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
		audio.init(filename, function(){
			fragments = analyzer.getFragmentsAndSummarizedFeatures(filename, useSegmentation);
			var vectors = fragments.map(function(f){return f["vector"];});
			clustering = new kmeans.Clustering(vectors, numClusters);
			callback();
		});
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
	
	function charsToWav(chars) {
		var randomElementIndices = Array.prototype.map.call(chars, function(c){return clustering.getRandomClusterElement(c);});
		return indicesToWav(randomElementIndices);
	}
	
	function indicesToWav(fragmentIndices) {
		return audio.fragmentsToWav(fragmentIndices.map(function(i){return fragments[i];}));
	}
	
	app.listen("8088");
	
	console.log('Server started at http://localhost:8088');
	
}).call(this);
