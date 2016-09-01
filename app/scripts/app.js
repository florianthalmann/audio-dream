(function () {
	'use strict';

	// create the angular app
	angular.module('audioDream', [
		'audioDream.controllers',
		'audioDream.directives'
	]);

	// setup dependency injection
	angular.module('d3', []);
	angular.module('audioDream.controllers', []);
	angular.module('audioDream.directives', ['d3']);

}());