(function() {
	
	var fs = require('fs');
	var async = require('async');
	var stream = require('stream');
	var express = require('express');
	var bodyParser = require('body-parser');
	var wav = require('wav');
	var Speaker = require('speaker');
	var exec = require('child_process').exec;
	var math = require('mathjs');
	var net = require('./net.js');
	var kmeans = require('./kmeans.js');
	
	var app = express();
	
	app.use(express["static"](__dirname + '/app'));
	app.use(bodyParser.raw({ type: 'audio/wav', limit: '50mb' }));
	
	var features = ['vamp:qm-vamp-plugins:qm-onsetdetector:onsets', 'vamp:vamp-example-plugins:amplitudefollower:amplitude', 'vamp:qm-vamp-plugins:qm-chromagram:chromagram', 'vamp:vamp-example-plugins:spectralcentroid:logcentroid', 'vamp:qm-vamp-plugins:qm-mfcc:coefficients'];
	var audioFolder = 'recordings/';
	var featureFolder = 'recordings/features/';
	var currentFileCount = 0;
	var fragmentLength = 0.02;
	var fadeLength = 0.01;
	var numClusters;
	
	var wavMemory = {};
	var speaker, speakerOut;
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
		execute('sox '+path+' '+tempPath+' trim 0.003', function(success) {
			if (success) {
				execute('mv '+tempPath+' '+path);
			}
		});
	}
	
	//extractFeature(audioFolder+'fugue.wav', 'vamp:qm-vamp-plugins:qm-barbeattracker:beats');
	setupTest('boner.wav', function() {
		testOriginalSequence();
	});
	
	function testClusters() {
		var clusters = clustering.getClusters();
		var i = 0;
		async.eachSeries(clusters, function(cluster, callback) {
			var wav = indicesToWav(cluster);
			var duration = wav.length/44100/2/2;
			console.log("playing cluster " + i + " with size " + cluster.length + " and duration " + duration);
			speakerOut.push(wav);
			i++;
			setTimeout(callback, (1000*duration)-50);
		}, function(err) {
			speakerOut.push(null);
			console.log(err);
		});
	}
	
	function testOriginalSequence() {
		var chars = clustering.getCharSequence();
		//console.log(chars)
		speakerOut.push(charsToWav(chars));
		speakerOut.push(null);
	}
	
	function testSamplingTheNet() {
		//create list of sentences of 50 chars
		var charSentences = clustering.getCharSequence().match(/.{1,50}/g);
		lstm = new net.Lstm(charSentences);
		lstm.learn();
		startSampling(speakerOut);
	}
	
	function setupTest(filename, callback) {
		getWavIntoMemory(filename, function(){
			fragments = getFragmentsAndSummarizedFeatures(filename);
			var vectors = fragments.map(function(s){return s["vector"];});
			clustering = new kmeans.Clustering(vectors, numClusters);
			resetSpeakerOut();
			callback();
		});
	}
	
	function resetSpeakerOut() {
		if (!speaker) {
			speaker = new Speaker({
				channels: 2,          // 2 channels
				bitDepth: 16,         // 16-bit samples
				sampleRate: 44100     // 44,100 Hz sample rate
			});
		}
		speakerOut = new stream.PassThrough();
		speakerOut.pipe(speaker);
	}
	
	function startSampling(output) {
		isSampling = true;
		samplingLoop(output);
	}
	
	function samplingLoop(output) {
		if (isSampling) {
			var sample = lstm.sample();
			charsToWav(sample, function(wav){
				output.push(wav);
				//TODO CALCULATE AS BELOW
				var duration = wav.length/44100/2/2;
				console.log(sample, duration);
				setTimeout(function() {
					samplingLoop(output);
				}, (1000*duration)-100);
			});
		}
	}
	
	function stopSampling() {
		isSampling = false;
	}
	
	function indicesToWav(fragmentIndices) {
		var wavs = Array.prototype.map.call(fragmentIndices, function(c){return getWavOfFragment(c);});
		return Buffer.concat(wavs);
	}
	
	function charsToWav(chars) {
		var wavs = Array.prototype.map.call(chars, function(c){return charToWav(c);});
		var parts = [];
		var bitFade = 176400*fadeLength; //TODO GET THIS FROM FORMAT!!!
		//push the initial segment before the first crossfade
		parts.push(wavs[0].slice(0, wavs[0].length-bitFade));
		for (var i = 0; i < wavs.length-1; i++) {
			//push the crossfade part
			parts.push(getBufferSum(wavs[i].slice(wavs[i].length-bitFade), wavs[i+1].slice(0, bitFade)));
			//push the part where i+1 plays alone
			parts.push(wavs[i+1].slice(bitFade, wavs[i+1].length-bitFade));
		}
		//push the last segment after the last crossfade
		parts.push(wavs[wavs.length-1].slice(wavs[wavs.length-1].length-bitFade));
		//concat everything and return
		return Buffer.concat(parts);
	}
	
	function getBufferSum(b1, b2) {
		var sum = Buffer.from(b1);
		for (var s = 0; s < b1.length; s+=2) {
			sum.writeInt16LE(b1.readInt16LE(s)+b2.readInt16LE(s), s);
		}
		return sum;
	}
	
	function charToWav(char) {
		var randomElement = clustering.getRandomClusterElement(char);
		return getWavOfFragment(randomElement);
	}
	
	function getWavOfFragment(index) {
		var filename = fragments[index]["file"];
		var fromSecond = fragments[index]["time"];
		var toSecond = fromSecond+fragments[index]["duration"];
		return getSampleFragment(filename, fromSecond, toSecond);
	}
	
	function getSampleFragment(filename, fromSecond, toSecond) {
		fromSecond -= fadeLength/2;
		if (fromSecond < 0) {
			fromSecond = 0;
		}
		toSecond += fadeLength/2;
		var format = wavMemory[filename]['format'];
		//console.log(format)
		var factor = format.byteRate;
		fromSample = Math.round(fromSecond*factor);
		toSample = Math.round(toSecond*factor);
		var segment = Buffer.from(wavMemory[filename]['data'].slice(fromSample, toSample));
		//console.log(filename, fromSample, toSample, segment.length)
		fadeSegment(segment, fadeLength*factor, format.bitDepth/8);
		return segment;
	}
	
	function fadeSegment(segment, numSamples, byteDepth) {
		//console.log(segment, segment.length)
		for (var i = 0; i < numSamples; i+=byteDepth) {
			var j = segment.length-byteDepth-i; //backwards from last sample
			var factor = i/numSamples;
			/*console.log(i, segment.readInt16LE(i), factor*segment.readInt16LE(i), factor);
			console.log(j, segment.readInt16LE(j), factor*segment.readInt16LE(j), factor);*/
			segment.writeInt16LE(factor*segment.readInt16LE(i), i);
			segment.writeInt16LE(factor*segment.readInt16LE(j), j);
			//segment[i] = Math.floor(factor*segment[i]);
			//segment[j] = Math.floor(factor*segment[j]);
			/*if (i == 1000) {
				console.log(i, segment[i], segment[j], factor);
			}*/
		}
	}
	
	function getWavIntoMemory(filename, callback) {
		wavMemory[filename] = {};
		var file = fs.createReadStream(audioFolder+filename);
		var data = []; // array that collects all the chunks
		var reader = new wav.Reader();
		reader.on('format', function (format) {
			wavMemory[filename]['format'] = format;
		});
		reader.on('data', function (chunk) {
			data.push(chunk);
		});
		reader.on('error', function() {
			console.log("node-wav reader couldn't read " + filename);
		})
		reader.on('end', function() {
			wavMemory[filename]['data'] = Buffer.concat(data);
			callback();
		});
		file.pipe(reader);
	}
	
	function extractFeatures(path, callback) {
		extractFeature(path, 'vamp:qm-vamp-plugins:qm-onsetdetector:onsets', function() {
			extractFeature(path, 'vamp:vamp-example-plugins:amplitudefollower:amplitude', function() {
				extractFeature(path, 'vamp:vamp-example-plugins:spectralcentroid:logcentroid', function() {
					//extractFeature(path, 'vamp:qm-vamp-plugins:qm-chromagram:chromagram');
					if (callback) { callback(); }
				});
			});
		});
	}
	
	function extractFeature(path, feature, callback) {
		var destination = featureFolder + path.replace('.wav', '_').slice(path.lastIndexOf('/')+1) + feature.replace(/:/g, '_') + '.json';
		execute('sonic-annotator -d ' + feature + ' ' + path + ' -w jams', function(success) {
			if (success) {
				execute('mv '+path.replace('.wav', '')+'.json '+destination, function(success) {
					if (callback) { callback(); }
				});
			}
		});
	}
	
	function getFragmentsAndSummarizedFeatures(path, callback) {
		var files = fs.readdirSync(featureFolder);
		var name = path.replace('.wav', '');
		files = files.filter(function(f){return f.indexOf(name) == 0;});
		files = files.map(function(f){return featureFolder+f;})
		var featureFiles = files.filter(function(f){return f.indexOf('onsets') < 0 && f.indexOf('beats') < 0;});
		var fragments = createFragments(featureFiles[0]);
		for (var i = 0; i < featureFiles.length; i++) {
			addSummarizedFeature(featureFiles[i], fragments);
		}
		//remove all fragments that contain undefined features
		for (var i = fragments.length-1; i >= 0; i--) {
			if (fragments[i]["vector"].filter(function(v) {return v === undefined;}).length > 0) {
				fragments.splice(i, 1);
			}
		}
		return fragments;
	}
	
	function getSegmentsAndSummarizedFeatures(path, callback) {
		var files = fs.readdirSync(featureFolder);
		var name = path.replace('.wav', '');
		files = files.filter(function(f){return f.indexOf(name) == 0;});
		files = files.map(function(f){return featureFolder+f;})
		var onsetFiles = files.filter(function(f){return f.indexOf('onsets') >= 0 || f.indexOf('beats') >= 0;});
		var otherFiles = files.filter(function(f){return onsetFiles.indexOf(f) < 0;});
		var segments = getEventsWithDuration(onsetFiles[0]);
		for (var i = 0; i < otherFiles.length; i++) {
			addSummarizedFeature(otherFiles[i], segments);
		}
		return segments;
	}
	
	function createFragments(featurepath) {
		var json = readJsonSync(featurepath);
		var events = [];
		var fileName = json["file_metadata"]["identifiers"]["filename"];
		var fileDuration = json["file_metadata"]["duration"];
		for (var i = 0; i < fileDuration; i+=fragmentLength) {
			var duration = i+fragmentLength>fileDuration ? fileDuration-i : fragmentLength;
			events.push(createEvent(fileName, i, duration));
		}
		return events;
	}
	
	function getEventsWithDuration(path) {
		var json = readJsonSync(path);
		var events = [];
		var fileName = json["file_metadata"]["identifiers"]["filename"];
		var fileDuration = json["file_metadata"]["duration"];
		var onsets = json["annotations"][0]["data"].map(function(o){return o["time"];});
		if (onsets[0] > 0) {
			events.push(createEvent(fileName, 0, onsets[0]));
		}
		for (var i = 0; i < onsets.length; i++) {
			var duration = i<onsets.length-1 ? onsets[i+1]-onsets[i] : fileDuration-onsets[i];
			events.push(createEvent(fileName, onsets[i], duration));
		}
		return events;
	}
	
	function createEvent(file, time, duration) {
		return {"file":file, "time":time, "duration":duration, "vector":[]};
	}
	
	function addSummarizedFeature(path, segments) {
		var json = readJsonSync(path);
		var featureName = json["annotations"][0]["annotation_metadata"]["annotator"]["output_id"];
		var data = json["annotations"][0]["data"];
		for (var i = 0; i < segments.length; i++) {
			var currentOnset = segments[i]["time"];
			var currentOffset = currentOnset+segments[i]["duration"];
			var currentData = data.filter(function(d){return currentOnset<=d["time"] && d["time"]<currentOffset;});
			var currentValues = currentData.map(function(d){return d["value"]});
			var means = getMean(currentValues);
			var vars = getVariance(currentValues);
			segments[i][featureName+"_mean"] = means;
			segments[i][featureName+"_var"] = vars;
			//segments[i]["vector"] = segments[i]["vector"].concat(Array.isArray(means) ? means : [means]); //see with just means
			segments[i]["vector"] = segments[i]["vector"].concat(Array.isArray(means) ? means.concat(vars) : [means, vars]);
		}
	}
	
	function getMean(values) {
		return mapValueOrArray(math.mean, values);
	}
	
	function getVariance(values) {
		return mapValueOrArray(math.var, values);
	}
	
	function mapValueOrArray(func, values) {
		if (values.length > 0) {
			if (Array.isArray(values[0])) {
				return math.transpose(values).map(function(v){return func.apply(this, v);});
			}
			return func.apply(this, values);
		}
	}
	
	function readJsonSync(path) {
		return JSON.parse(fs.readFileSync(path, 'utf8'));
	}
	
	function execute(command, callback) {
		exec(command, {stdio: ['pipe', 'pipe', 'ignore']}, function(error, stdout, stderr) {
			if (error) {
				console.log(stderr);
				if (callback) { callback(false); }
			} else {
				if (callback) { callback(true); }
			}
		});
	}
	
	app.listen("8088");
	
	console.log('Server started at http://localhost:8088');
	
}).call(this);
