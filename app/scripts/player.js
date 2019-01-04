/**
 * @constructor
 */
function AudioPlayer(Tone, $scope, socket) {

	var SCHEDULE_AHEAD_TIME = 0.2; //seconds
	var MIN_DELAY_BETWEEN_SOURCES = 0.01; //seconds
	var FADE_LENGTH = 0.05//2; //seconds
	var EFFECTS_AMOUNT = 0.5//0.5; //1-10
	var mainGain, reverbSend;
	var currentSource, nextSource, nextSourceTime;
	var isPlaying, timeoutID;
	$scope.fragments = [];
	$scope.currentFragments = [];
	var nextFragmentIndex;

	init();

	function init() {
		mainGain = Tone.context.createGain();
		mainGain.connect(Tone.Master);
		reverbSend = new Tone.Freeverb(0.95, 10000)
		reverbSend.connect(mainGain);
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

	function getCurrentDelay() {
		if (!nextSourceTime) {
			return SCHEDULE_AHEAD_TIME;
		} else {
			return Math.max(0, nextSourceTime-Tone.Transport.seconds);
		}
	}

	async function createNextTonePlayer(callback) {
		var reverb = new Tone.Volume(Tone.gainToDb(2*EFFECTS_AMOUNT)).connect(reverbSend);
		var panner = Tone.context.createPanner();
		panner.setPosition(EFFECTS_AMOUNT*Math.random()*20-10, EFFECTS_AMOUNT*Math.random()*20-10, EFFECTS_AMOUNT*Math.random()*20-10);
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
		//TODO DISCONNECT AND DISPOSE WHEN DONE!!
	}

}