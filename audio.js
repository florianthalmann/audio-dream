var Audio = {};
module.exports = Audio;

(function(global) {
	"use strict";
	
	var fs = require('fs');
	var stream = require('stream');
	var wav = require('wav');
	var Speaker = require('speaker');
	
	var audioFolder = 'recordings/';
	var wavMemory = {};
	var speaker, speakerOut;
	
	var fragmentLength = 0.05;
	var fadeLength = 0.01;
	
	var init = function(filename, callback) {
		resetSpeakerOut();
		getWavIntoMemory(filename, callback);
	}
	
	var end = function() {
		speakerOut.push(null);
	}
	
	var play = function(wav, thereWillBeMore) {
		speakerOut.push(wav);
		if (!thereWillBeMore) {
			end();
		}
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
	
	var fragmentsToWav = function(fragments) {
		var wavs = fragments.map(function(f){return getWavOfFragment(f);});
		var parts = [];
		//even number fade length for 16bit
		var bitFade = Math.round(176400*fadeLength/2)*2; //TODO GET THIS FROM FORMAT!!!
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
			sum.writeInt16LE(b1.readInt16LE(s)+b2.readInt16LE(s), s, false);
		}
		return sum;
	}
	
	function getWavOfFragment(fragment) {
		var filename = fragment["file"];
		var fromSecond = fragment["time"];
		var toSecond = fromSecond+fragment["duration"];
		return getSampleFragment(filename, fromSecond, toSecond);
	}
	
	function getSampleFragment(filename, fromSecond, toSecond) {
		fromSecond -= fadeLength/2;
		if (fromSecond < 0) {
			fromSecond = 0;
		}
		toSecond += fadeLength/2;
		var format = wavMemory[filename]['format'];
		var factor = format.byteRate;
		var fromSample = Math.round(fromSecond*factor);
		var toSample = Math.round(toSecond*factor);
		var segment = Buffer.from(wavMemory[filename]['data'].slice(fromSample, toSample));
		fadeSegment(segment, fadeLength*factor, format.bitDepth/8);
		return segment;
	}
	
	function fadeSegment(segment, numSamples, byteDepth) {
		for (var i = 0; i < numSamples; i+=byteDepth) {
			var j = segment.length-byteDepth-i; //backwards from last sample
			var factor = i/numSamples;
			segment.writeInt16LE(factor*segment.readInt16LE(i), i);
			segment.writeInt16LE(factor*segment.readInt16LE(j), j);
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
	
	global.init = init;
	global.play = play;
	global.fragmentsToWav = fragmentsToWav;
	
})(Audio);