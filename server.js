(function() {
	
	var fs = require('fs');
	var express = require('express');
	var bodyParser = require('body-parser');
	var wav = require('wav');
	var exec = require('child_process').exec;
	var math = require('mathjs');
	
	var app = express();
	
	app.use(express["static"](__dirname + '/app'));
	app.use(bodyParser.raw({ type: 'audio/wav', limit: '50mb' }));
	
	var features = ['vamp:qm-vamp-plugins:qm-onsetdetector:onsets', 'vamp:vamp-example-plugins:amplitudefollower:amplitude', 'vamp:qm-vamp-plugins:qm-chromagram:chromagram', 'vamp:vamp-example-plugins:spectralcentroid:logcentroid'];
	var audioFolder = 'recordings/';
	var featureFolder = 'recordings/features/'
	var currentFileCount = 0;
	
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
	
	//extractFeatures(audioFolder+'0.wav', featureFolder);
	getSegmentsAndSummarizedFeatures('0')
	
	function extractFeatures(path) {
		extractFeature(path, 'vamp:qm-vamp-plugins:qm-onsetdetector:onsets', function() {
			extractFeature(path, 'vamp:vamp-example-plugins:amplitudefollower:amplitude', function() {
				extractFeature(path, 'vamp:vamp-example-plugins:spectralcentroid:logcentroid', function() {
					//extractFeature(path, 'vamp:qm-vamp-plugins:qm-chromagram:chromagram');
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
	
	function getSegmentsAndSummarizedFeatures(path) {
		var segments = {};
		fs.readdir(featureFolder, function(err, files) {
			var name = path.replace('.wav', '');
			files = files.filter(function(f){return f.indexOf(name) == 0;});
			files = files.map(function(f){return featureFolder+f;})
			var onsetsFile = files.filter(function(f){return f.indexOf('onsets') > 0;})[0];
			var otherFiles = files.filter(function(f){return f != onsetsFile;});
			getEventsWithDuration(onsetsFile, function(segments) {
				for (var i = 0; i < otherFiles.length; i++) {
					addSummarizedFeature(otherFiles[i], segments, function(){
						console.log(segments)
					});
				}
			});
		});
	}
	
	function getEventsWithDuration(path, callback) {
		readJson(path, function(json) {
			var events = [];
			var fileName = json["file_metadata"]["identifiers"]["filename"];
			var fileDuration = json["file_metadata"]["duration"];
			var onsets = json["annotations"][0]["data"].map(function(o){return o["time"];});
			if (onsets[0] > 0) {
				events.push({"file":fileName, "time":0, "duration":onsets[0]});
			}
			for (var i = 0; i < onsets.length; i++) {
				var duration = i<onsets.length-1 ? onsets[i+1]-onsets[i] : fileDuration-onsets[i];
				events.push({"file":fileName, "time":onsets[i], "duration":duration});
			}
			callback(events);
		});
	}
	
	function addSummarizedFeature(path, segments, callback) {
		readJson(path, function(json) {
			var featureName = json["annotations"][0]["annotation_metadata"]["annotator"]["output_id"];
			var data = json["annotations"][0]["data"];
			for (var i = 0; i < segments.length; i++) {
				var currentOnset = segments[i]["time"];
				var currentOffset = currentOnset+segments[i]["duration"];
				var currentData = data.filter(function(d){return currentOnset<=d["time"] && d["time"]<currentOffset;});
				var currentValues = currentData.map(function(d){return d["value"]});
				segments[i][featureName+"_mean"] = getMean(currentValues);
				segments[i][featureName+"_var"] = getVariance(currentValues);
			}
			callback();
		});
	}
	
	function getMean(values) {
		return mapValueOrArray(math.mean, values);
		/*if (Array.isArray(values[0])) {
			average = values.reduce(function(p,c){ return p.map(function(v,i){ return v+c[i]; }); });
			return average.map(function(a){return a/values.length;});
		}
		return values.reduce(function(p,c){ return p+c; }) / values.length;*/
	}
	
	function getVariance(values) {
		return mapValueOrArray(math.var, values);
	}
	
	function mapValueOrArray(func, values) {
		if (Array.isArray(values[0])) {
			return math.transpose(values).map(function(v){return func.apply(this, v);});
		}
		return func.apply(this, values);
	}
	
	function readJson(path, callback) {
		fs.readFile(path, 'utf8', function (err, data) {
			console.log(path)
			if (err) throw err;
			callback(JSON.parse(data));
		});
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
