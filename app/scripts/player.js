/**
 * @constructor
 */
function AudioPlayer(audioContext, $scope, socket) {
	
	var SCHEDULE_AHEAD_TIME = 0.1; //seconds
	var FRAGMENT_LENGTH; //seconds
	var FADE_LENGTH = 0.5; //seconds
	var reverbSend;
	var currentSource, nextSource, nextSourceTime;
	var isPlaying, timeoutID;
	$scope.fragments = [];
	$scope.currentFragments = [];
	var nextFragmentIndex;
	
	init();
	
	function init() {
		reverbSend = audioContext.createConvolver();
		reverbSend.connect(audioContext.destination);
		loadAudio('impulse_rev.wav', function(buffer) {
			reverbSend.buffer = buffer;
		});
	}
	
	$scope.changeFadeLength = function(value) {
		console.log(value)
		FADE_LENGTH = value;
	}
	
	socket.on('fragments', function (data) {
		$scope.fragments = data.fragments;
		$scope.$apply();
	});
	
	socket.on('nextFragmentIndex', function (data) {
		nextFragmentIndex = data.nextFragmentIndex;
	});
	
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
		setTimeout(function(){
			$scope.currentFragments = [$scope.fragments[nextFragmentIndex]];
			setTimeout(function(){
				$scope.$apply();
			}, 100);
		}, 1000*(delay+FADE_LENGTH));
		console.log(currentSource.buffer.duration)
		//create next sources and wait or end and reset
		createNextSource(function() {
			nextSourceTime = startTime+(currentSource.buffer.duration/currentSource.playbackRate.value)-(2*FADE_LENGTH);
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
		var source = audioContext.createBufferSource();
		var panner = audioContext.createPanner();
		panner.connect(audioContext.destination);
		var dryGain = audioContext.createGain();
		dryGain.connect(panner);
		dryGain.gain.value = 0.8;
		source.connect(dryGain);
		panner.setPosition(Math.random()*2-1, Math.random()*2-1, Math.random()*2-1);
		var reverbGain = audioContext.createGain();
		reverbGain.connect(reverbSend);
		reverbGain.gain.value = 0.3;
		source.connect(reverbGain);
		//source.playbackRate.value = Math.pow(2, (Math.round(Math.random()*6)-4)/6);
		source.onended = function() {
			//disconnect all nodes
			source.disconnect();
			panner.disconnect();
			dryGain.disconnect();
			reverbGain.disconnect();
		};
		requestAudio(function(loadedBuffer) {
			source.buffer = loadedBuffer;
			nextSource = source;
			callback();
		});
	}
	
	function requestAudio(callback) {
		var query = "http://localhost:8088/getNextFragment?fadelength="+FADE_LENGTH+"&fragmentlength="+FRAGMENT_LENGTH;
		loadAudio(query, callback);
	}
	
	function loadAudio(path, callback) {
		request(path, 'arraybuffer', function(err, response){
			if (err) {
				console.log('audio from server is faulty');
				return;
			}
			console.log(response);
			audioContext.decodeAudioData(response, callback);
		});
	}
	
	function request(path, responseType, callback) {
		var request = new XMLHttpRequest();
		request.open('GET', path, true);
		request.responseType = responseType;
		request.onload = function() { callback(null, request.response); }
		request.error = function(err) { callback(err); }
		request.send();
	}
	
}