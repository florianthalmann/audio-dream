/**
 * @constructor
 */
function AudioPlayer(Tone, $scope, socket) {

	var SCHEDULE_AHEAD_TIME = 0.2; //seconds
	var MIN_DELAY_BETWEEN_SOURCES = 0.01; //seconds
	var FADE_LENGTH = 0.05//2; //seconds
	var EFFECTS_AMOUNT = 0.5//0.5; //1-10
	var reverbSend;
	var currentSource, nextSource, nextSourceTime;
	var isPlaying, timeoutID;
	$scope.fragments = [];
	$scope.currentFragments = [];
	var nextFragmentIndex;

	init();

	function init() {
		//mainGain = audioContext.createGain();
		//mainGain.connect(audioContext.destination);
		reverbSend = new Tone.Freeverb().toMaster();//audioContext.createConvolver();
		//reverbSend.connect(mainGain);
		/*loadAudio('impulse_rev.wav', function(buffer) {
			reverbSend.buffer = buffer;
		});*/
	}

	this.getMainGain = function() {
		return mainGain;
	}

	$scope.changeFadeLength = function(value) {
		FADE_LENGTH = value;
		socket.emit('changeFadeLength', {value:value});
	}

	$scope.changeEffectsAmount = function(value) {
		EFFECTS_AMOUNT = value;
	}

	$scope.changeGain = function(value) {
		if (mainGain) {
			mainGain.gain.value = value;
		}
	}

	socket.on('fragments', function (data) {
		$scope.fragments = data.fragments;
		$scope.$apply();
	});

	socket.on('nextFragmentIndex', function (data) {
		nextFragmentIndex = data.nextFragmentIndex;
	});

	this.isPlaying = function() {
		return isPlaying;
	}

	this.play = function() {
		Tone.Transport.start('+0.1');
		if (!isPlaying) {
			isPlaying = true;
			createNextTonePlayer(() => {
				setTimeout(() => tonePlayLoop(), 300);
			});
		}
	}

	this.stop = function() {
		console.log("STOP")
		if (Tone.Transport.state == "started") {
			Tone.Transport.stop();
		}
		isPlaying = false;
		//stops slowly by letting current source finish
		window.clearTimeout(timeoutID);
	}
	
	function tonePlayLoop() {
		currentSource = nextSource;
		//calculate delay and schedule
		var delay = getCurrentDelay();
		var startTime = Tone.Transport.seconds+delay;
		currentSource.sync().start(startTime);
		console.log(Tone.Transport.seconds, delay, startTime);
		setTimeout(function(){
			$scope.currentFragments = [$scope.fragments[nextFragmentIndex]];
			//new Tone.Synth().toMaster().triggerAttackRelease('C4', '8n');
			setTimeout(function(){
				$scope.$apply();
			}, 100);
		}, 1000*(delay+FADE_LENGTH));
		//console.log(currentSource.buffer.duration)
		//create next sources and wait or end and reset
		createNextTonePlayer(() => {
			var currentSourceDuration = currentSource.buffer.duration/currentSource.playbackRate;
			//console.log(currentSourceDuration)
			//console.log(currentSourceDuration, (2*FADE_LENGTH)+MIN_DELAY_BETWEEN_SOURCES)
			//if (currentSourceDuration > (2*FADE_LENGTH)+MIN_DELAY_BETWEEN_SOURCES) {
				currentSourceDuration = Math.max(0, currentSourceDuration-2*FADE_LENGTH);
			//}
			nextSourceTime = startTime+currentSourceDuration;
			//console.log(nextSourceTime)
			var wakeupTime = (nextSourceTime-Tone.Transport.seconds-SCHEDULE_AHEAD_TIME)*1000;
			console.log(Tone.Transport.seconds, currentSource.buffer.duration, currentSourceDuration, nextSourceTime, wakeupTime)
			timeoutID = setTimeout(tonePlayLoop.bind(this), wakeupTime);
		});
	}

	/*function playLoop() {
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
		//console.log(currentSource.buffer.duration)
		//create next sources and wait or end and reset
		createNextSource(function() {
			var currentSourceDuration = currentSource.buffer.duration/currentSource.playbackRate.value;
			//console.log(currentSourceDuration)
			//console.log(currentSourceDuration, (2*FADE_LENGTH)+MIN_DELAY_BETWEEN_SOURCES)
			//if (currentSourceDuration > (2*FADE_LENGTH)+MIN_DELAY_BETWEEN_SOURCES) {
				currentSourceDuration -= 2*FADE_LENGTH;
			//}
			nextSourceTime = startTime+currentSourceDuration;
			//console.log(nextSourceTime)
			var wakeupTime = (nextSourceTime-audioContext.currentTime-SCHEDULE_AHEAD_TIME)*1000;
			timeoutID = setTimeout(function() {
				playLoop();
			}, wakeupTime);
		});
	}*/

	function getCurrentDelay() {
		if (!nextSourceTime) {
			return SCHEDULE_AHEAD_TIME;
		} else {
			return Math.max(0, nextSourceTime-Tone.Transport.seconds);
		}
	}

	/*function fadeBuffer(buffer) {
		var durationInSamples = buffer.length/2;
		console.log(durationInSamples, buffer.numberOfChannels, buffer.sampleRate)
		var fadeSamples = buffer.sampleRate*FADE_LENGTH;
		for (var i = 0; i < buffer.numberOfChannels; i++) {
			var currentChannel = buffer.getChannelData(i);
			console.log(currentChannel.slice(0,5))
			for (var j = 0.0; j < fadeSamples; j++) {
				currentChannel[j] *= j/fadeSamples;
				currentChannel[durationInSamples-j-1] *= j/fadeSamples;
			}
			console.log(currentChannel.slice(0,5))
		}
	}*/

	async function createNextTonePlayer(callback) {
		var reverb = new Tone.Volume(Tone.gainToDb(EFFECTS_AMOUNT*10)).connect(reverbSend);
		var panner = Tone.context.createPanner();
		panner.setPosition(EFFECTS_AMOUNT*Math.random()*8-4, EFFECTS_AMOUNT*Math.random()*8-4, EFFECTS_AMOUNT*Math.random()*8-4);
		panner.connect(reverb);
		panner.connect(Tone.Master);
		//requestAudio((loadedBuffer, err) => {
		var buffer = await new Promise(resolve => 
			new Tone.Buffer("http://localhost:8088/getNextFragment", resolve));
		buffer = buffer || audioContext.createBuffer(2, 44100, 44100); //nice hack, insert one second of silence
			var player = new Tone.Player(buffer);
			player.connect(panner);
			
			player.fadeIn = player.fadeOut = FADE_LENGTH;
			if (EFFECTS_AMOUNT > 0.3) {
				//1+((EFFECTS_AMOUNT-0.3)*Math.random();//*
				player.playbackRate = Math.pow(2, (Math.round(Math.random()*6)-4)/6);
				console.log(player.playbackRate+1)
			}
			nextSource = player;
			callback();
		//});
	}

	/*function createNextSource(callback) {
		console.log("CREATE")
		var source = audioContext.createBufferSource();
		var panner = audioContext.createPanner();
		panner.connect(mainGain);
		var dryGain = audioContext.createGain();
		dryGain.connect(panner);
		dryGain.gain.value = 0.8;
		source.connect(dryGain);
		panner.setPosition(EFFECTS_AMOUNT*Math.random()*8-4, EFFECTS_AMOUNT*Math.random()*8-4, EFFECTS_AMOUNT*Math.random()*8-4);
		var reverbGain = audioContext.createGain();
		reverbGain.connect(reverbSend);
		reverbGain.gain.value = EFFECTS_AMOUNT;
		source.connect(reverbGain);
		if (EFFECTS_AMOUNT > 0.3) {
			source.playbackRate.value = (EFFECTS_AMOUNT-0.3)*Math.pow(2, (Math.round(Math.random()*6)-4)/6);
		}
		source.onended = function() {
			//disconnect all nodes
			source.disconnect();
			panner.disconnect();
			dryGain.disconnect();
			reverbGain.disconnect();
		};
		requestAudio(function(loadedBuffer, err) {
			if (loadedBuffer) {
				fadeBuffer(loadedBuffer);
				source.buffer = loadedBuffer;
			} else {
				source.buffer = audioContext.createBuffer(2, 44100, 44100); //nice hack, insert one second of silence
			}
			nextSource = source;
			callback();
		});
	}*/

	/*function requestAudio(callback) {
		var query = "http://localhost:8088/getNextFragment";
		loadAudio(query, callback);
	}*/

	/*function loadAudio(path, callback) {
		request(path, 'arraybuffer', function(err, response){
			if (err) {
				console.log('audio from server is faulty');
				return;
			}
			if (response.byteLength > 1000) {
				audioContext.decodeAudioData(response, callback);
			} else {
				callback();
			}
		});
	}*/

	/*function request(path, responseType, callback) {
		var request = new XMLHttpRequest();
		request.open('GET', path, true);
		request.responseType = responseType;
		request.onload = function() { callback(null, request.response); }
		request.error = function(err) { callback(err); }
		request.send();
	}*/

}