/**
 * @constructor
 */
function Sampler(audioContext, gains, $scope) {
	
	var samplerGain, reverbSend;
	var samples = [];
	var currentSamples = {};
	
	init();
	
	function init() {
		samplerGain = audioContext.createGain();
		for (var i = 0; i < gains.length; i++) {
			samplerGain.connect(gains[i]);
		}
		request('/getSampleList', 'json', function(err, response) {
			console.log(response);
			for (var i = 0; i < 64; i++) {
				if (response[i]) {
					loadSample('samples/'+response[i], i);
				}
			}
		});
	}
	
	$scope.setSamplerGain = function(gain) {
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
			var now = audioContext.currentTime;
			envelopeGain.gain.setValueAtTime(envelopeGain.gain.value, now);
			envelopeGain.gain.linearRampToValueAtTime(0, now+0.01);
			source.stop(now+0.02);
		}
	
		//bend should be between -1 and 1
		this.bendPitch = function(bend) {
			source.playbackRate.value = Math.pow(2, bend);
		}
	
		this.bendEnvelope = function(amplitude) {
			if (amplitude > 0) {
				envelopeGain.gain.value = amplitude;
			}
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