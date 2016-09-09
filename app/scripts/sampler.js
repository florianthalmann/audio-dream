/**
 * @constructor
 */
function Sampler(audioContext, mainGain, $scope) {
	
	var samplerGain, reverbSend;
	var samples = [];
	var currentSamples = {};
	
	init();
	
	function init() {
		samplerGain = audioContext.createGain();
		samplerGain.connect(mainGain);
		for (var i = 0; i < 64; i++) {
			loadSample('samples/'+i+'.wav', i);
		}
	}
	
	$scope.setGain = function(gain) {
		samplerGain.gain.value = gain;
	}
	
	$scope.startSample = function(index, amplitude) {
		if (!currentSamples[index]) {
			currentSamples[index] = new Source(samples[index], amplitude, function() {
				delete currentSamples[index];
			});
			currentSamples[index].start();
		}
	}
	
	$scope.stopSample = function(index) {
		if (currentSamples[index]) {
			currentSamples[index].stop();
		}
	}
	
	$scope.bendEnvelope = function(index, amplitude) {
		if (currentSamples[index]) {
			currentSamples[index].bendEnvelope(amplitude);
		}
	}
	
	$scope.bendPitch = function(bend) {
		for (var index in currentSamples) {
			currentSamples[index].bendPitch(bend);
		}
	}
	
	function Source(buffer, amplitude, onEnded) {
		var source = audioContext.createBufferSource();
		source.buffer = buffer;
		var envelopeGain = audioContext.createGain();
		envelopeGain.connect(samplerGain);
		envelopeGain.gain.value = amplitude;
		source.connect(envelopeGain);
		source.onended = function() {
			source.disconnect();
			envelopeGain.disconnect();
			onEnded();
		};
	
		this.start = function() {
			source.start();
		};
	
		this.stop = function() {
			source.stop();
		}
	
		//bend should be between -1 and 1
		this.bendPitch = function(bend) {
			source.playbackRate.value = Math.pow(2, bend);
		}
	
		this.bendEnvelope = function(amplitude) {
			envelopeGain.gain.value = amplitude+0.0001;
		}
	}
	
	function loadSample(path, index) {
		request(path, 'arraybuffer', function(err, response){
			if (err) {
				console.log('audio from server is faulty');
				return;
			}
			audioContext.decodeAudioData(response, function(buffer) {
				samples[index] = buffer;
			});
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