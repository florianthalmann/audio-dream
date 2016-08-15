(function() {
	
	var fs = require('fs');
	var express = require('express');
	var bodyParser = require('body-parser');
	var wav = require('wav');
	var exec = require('child_process').exec;
	var math = require('mathjs');
	var clusterfck = require('clusterfck');
	var net = require('./net.js');
	
	var app = express();
	
	app.use(express["static"](__dirname + '/app'));
	app.use(bodyParser.raw({ type: 'audio/wav', limit: '50mb' }));
	
	var features = ['vamp:qm-vamp-plugins:qm-onsetdetector:onsets', 'vamp:vamp-example-plugins:amplitudefollower:amplitude', 'vamp:qm-vamp-plugins:qm-chromagram:chromagram', 'vamp:vamp-example-plugins:spectralcentroid:logcentroid'];
	var audioFolder = 'recordings/';
	var featureFolder = 'recordings/features/'
	var currentFileCount = 0;
	var fragmentLength = 0.05;
	
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
		execute('sox '+path+' '+tempPath+' trim 0.003', function(success) {
			if (success) {
				execute('mv '+tempPath+' '+path);
			}
		});
	}
	
	//extractFeatures(audioFolder+'fugue.wav', function() {
		var segments = getFragmentsAndSummarizedFeatures('fugue');
		var vectors = segments.map(function(s){return s["vector"];});
		var clusters = clusterfck.kmeans(vectors).map(function(c){return c.map(function(v){return vectors.indexOf(v);})});
		console.log(vectors.length, clusters.length);
		var clusterIndices = [];
		for (var i = 0; i < clusters.length; i++) {
			for (var j = 0; j < clusters[i].length; j++) {
				clusterIndices[clusters[i][j]] = i;
			}
		}
		var chars = clusterIndices.map(function(i){return String.fromCharCode(65+i);}).join('').match(/.{1,50}/g);
		console.log(chars)
		
		var lstm = new net.Lstm(chars);
		lstm.learn();
		
	//});
	
	
	
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
		var featureFiles = files.filter(function(f){return f.indexOf('onsets') < 0;});
		var fragments = createFragments(featureFiles[0]);
		for (var i = 0; i < featureFiles.length; i++) {
			addSummarizedFeature(featureFiles[i], fragments);
		}
		return fragments;
	}
	
	function getSegmentsAndSummarizedFeatures(path, callback) {
		var files = fs.readdirSync(featureFolder);
		var name = path.replace('.wav', '');
		files = files.filter(function(f){return f.indexOf(name) == 0;});
		files = files.map(function(f){return featureFolder+f;})
		var onsetsFile = files.filter(function(f){return f.indexOf('onsets') > 0;})[0];
		var otherFiles = files.filter(function(f){return f != onsetsFile;});
		var segments = getEventsWithDuration(onsetsFile);
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
		return {"file":file, "time":time, "duration":duration, "vector":[time, duration]};
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
		return 0;
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
