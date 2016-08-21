var Audio = {};
module.exports = Audio;

(function(global) {
	"use strict";
	
	var fs = require('fs');
	var stream = require('stream');
	var wav = require('wav');
	var Speaker = require('speaker');
	
	var wavMemory = {};
	var speaker, speakerOut;
	
	var FADE_LENGTH = 0.01;
	
	var init = function(filename, audioFolder, callback) {
		resetSpeakerOut();
		getWavIntoMemory(filename, audioFolder, callback);
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
	
	var fragmentsToWav = function(fragments, fadeLength) {
		if (!isNaN(fadeLength)) {
			FADE_LENGTH = fadeLength;
		}
		var wavs = fragments.map(function(f){return getWavOfFragment(f);});
		var parts = [];
		//even number fade length for 16bit
		var bitFade = Math.round(176400*FADE_LENGTH/2)*2; //TODO GET THIS FROM FORMAT!!!
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
			var v1 = b1.readInt16LE(s);
			var v2 = b2.readInt16LE(s);
			sum.writeInt16LE(v1+v2, s, false);
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
		fromSecond -= FADE_LENGTH;
		if (fromSecond < 0) {
			fromSecond = 0;
		}
		toSecond += FADE_LENGTH;
		var format = wavMemory[filename]['format'];
		var factor = format.byteRate;
		var fromSample = Math.round(fromSecond*factor);
		var toSample = Math.round(toSecond*factor);
		var segment = Buffer.from(wavMemory[filename]['data'].slice(fromSample, toSample));
		fadeSegment(segment, FADE_LENGTH*factor, format.bitDepth/8);
		return segment;
	}
	
	function fadeSegment(segment, numSamples, byteDepth) {
		var fadeLength = Math.min(numSamples, segment.length);
		for (var i = 0; i < fadeLength; i+=byteDepth) {
			var j = segment.length-byteDepth-i; //backwards from last sample
			var factor = i/numSamples;
			segment.writeInt16LE(factor*segment.readInt16LE(i), i);
			if (j >= 0) {
				segment.writeInt16LE(factor*segment.readInt16LE(j), j);
			}
		}
	}
	
	function getWavIntoMemory(filename, audioFolder, callback) {
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