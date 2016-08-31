/**
 * @constructor
 */
function AudioPlayer(audioContext) {
	
	var SCHEDULE_AHEAD_TIME = 0.1; //seconds
	var FRAGMENT_LENGTH; //seconds
	var FADE_LENGTH = 0.5; //seconds
	var reverbSend;
	var currentSource, nextSource, nextSourceTime;
	var isPlaying, timeoutID;
	
	init();
	
	function init() {
		reverbSend = audioContext.createConvolver();
		reverbSend.connect(audioContext.destination);
		/*loadAudio(reverbFile, function(buffer) {
			reverbSend.buffer = buffer;
		});*/
	}
	
	this.play = function() {
		if (!isPlaying) {
			isPlaying = true;
			createNextSource(function() {
				playLoop();
			});
		}
	}
	
	this.stop = function() {
		isPlaying = false;
		//stops slowly by letting current source finish
		window.clearTimeout(timeoutID);
	}
	
	function playLoop() {
		currentSource = nextSource;
		//calculate delay and schedule
		var delay = getCurrentDelay();
		var startTime = audioContext.currentTime+delay;
		currentSource.start(startTime);
		console.log(currentSource.buffer.duration)
		//create next sources and wait or end and reset
		createNextSource(function() {
			nextSourceTime = startTime+currentSource.buffer.duration-(2*FADE_LENGTH);
			var wakeupTime = (nextSourceTime-audioContext.currentTime-SCHEDULE_AHEAD_TIME)*1000;
			timeoutID = setTimeout(function() {
				playLoop();
			}, wakeupTime);
		});
	}
	
	function getCurrentDelay() {
		if (!nextSourceTime) {
			return SCHEDULE_AHEAD_TIME;
		} else {
			return Math.max(0, nextSourceTime-audioContext.currentTime);
		}
	}
	
	function fadeBuffer(buffer, durationInSamples) {
		var fadeSamples = buffer.sampleRate*FADE_LENGTH;
		for (var i = 0; i < buffer.numberOfChannels; i++) {
			var currentChannel = buffer.getChannelData(i);
			for (var j = 0.0; j < fadeSamples; j++) {
				currentChannel[j] *= j/fadeSamples;
				currentChannel[durationInSamples-j-1] *= j/fadeSamples;
			}
		}
	}
	
	function createNextSource(callback) {
		var query = "http://localhost:8088/getNextFragment?fadelength="+FADE_LENGTH+"&fragmentlength="+FRAGMENT_LENGTH;
		var source = audioContext.createBufferSource();
		source.connect(audioContext.destination);
		loadAudio(query, function(loadedBuffer) {
			source.buffer = loadedBuffer;
			nextSource = source;
			callback();
		});
	}
	
	function loadAudio(path, callback) {
		//console.log(path)
		var request = new XMLHttpRequest();
		request.open('GET', path, true);
		request.responseType = 'arraybuffer';
		request.onload = function() {
			audioContext.decodeAudioData(request.response, function(buffer) {
				callback(buffer);
			}, function(err) {
				console.log('audio from server is faulty');
			});
		}
		request.send();
	}
	
}