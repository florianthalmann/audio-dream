var Analyzer = {};
module.exports = Analyzer;

(function(global) {
	"use strict";
	
	var fs = require('fs');
	var async = require('async');
	var math = require('mathjs');
	var util = require('./util.js');
	
	var featureFolder = 'features/';
	var currentPath;
	
	var extractFeatures = function(path, features) {
		currentPath = path;
		async.mapSeries(features, extractFeature, function(){
			console.log("DONE");
		});
	}
	
	function extractFeature(feature, callback) {
		console.log("extracting "+feature)
		var destination = featureFolder + currentPath.replace('.wav', '_').slice(currentPath.lastIndexOf('/')+1)
			+ feature.replace(/:/g, '_') + '.json';
		util.execute('sonic-annotator -d ' + feature + ' ' + currentPath + ' -w jams', function(success) {
			if (success) {
				util.execute('mv '+currentPath.replace('.wav', '')+'.json '+destination, function(success) {
					callback();
				});
			}
		});
	}
	
	var getFragmentsAndSummarizedFeatures = function(path, useSegmentation) {
		var files = fs.readdirSync(featureFolder);
		var name = path.replace('.wav', '');
		files = files.filter(function(f){return f.indexOf(name) == 0;});
		files = files.map(function(f){return featureFolder+f;});
		var fragments, featureFiles;
		if (useSegmentation) {
			var segmentationFiles = files.filter(function(f){return f.indexOf('onsets') >= 0 || f.indexOf('beats') >= 0;});
			featureFiles = files.filter(function(f){return segmentationFiles.indexOf(f) < 0;});
			fragments = getEventsWithDuration(segmentationFiles[0]);
		} else {
			featureFiles = files.filter(function(f){return f.indexOf('onsets') < 0 && f.indexOf('beats') < 0;});
			fragments = createFragments(featureFiles[0]);
		}
		for (var i = 0; i < featureFiles.length; i++) {
			addSummarizedFeature(featureFiles[i], fragments);
		}
		//remove all fragments that contain undefined features
		for (var i = fragments.length-1; i >= 0; i--) {
			if (fragments[i]["vector"].filter(function(v) {return v === undefined;}).length > 0) {
				fragments.splice(i, 1);
			}
		}
		//standardize the vectors
		var vectors = fragments.map(function(f){return f["vector"];});
		var transposed = math.transpose(vectors);
		var means = transposed.map(function(v){return math.mean(v);});
		var stds = transposed.map(function(v){return math.std(v);});
		//transposed = transposed.map(function(v,i){return v.map(function(e){return (e-means[i])/stds[i];})});
		for (var i = fragments.length-1; i >= 0; i--) {
			fragments[i]["vector"] = fragments[i]["vector"].map(function(e,j){return (e-means[j])/stds[j];});
		}
		return fragments;
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
		return {"file":file, "time":time, "duration":duration, "vector":[duration]};
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
			segments[i]["vector"] = segments[i]["vector"].concat(Array.isArray(means) ? means : [means]); //see with just means
			//segments[i]["vector"] = segments[i]["vector"].concat(Array.isArray(means) ? means.concat(vars) : [means, vars]);
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
	
	global.extractFeatures = extractFeatures;
	global.getFragmentsAndSummarizedFeatures = getFragmentsAndSummarizedFeatures;
	
})(Analyzer);