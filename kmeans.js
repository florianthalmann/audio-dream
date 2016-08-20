var Kmeans = {};
module.exports = Kmeans;

(function(global) {
	"use strict";
	
	var clusterfck = require('clusterfck');
	
	var FIRST_CHAR = 65;
	
	var Clustering = function(vectors, clusterCount) {
		
		//clusters with the indices of all feature vectors
		console.log("Clustering...");
		var clusters = clusterfck.kmeans(vectors, clusterCount).map(function(c){return c.map(function(v){return vectors.indexOf(v);})});
		console.log("Clustered " + vectors.length + " vectors into " + clusters.length + " clusters");
		
		this.length = function() {
			return clusters.length;
		}
		
		//returns a string with the cluster char for each vector in the original list
		this.getCharSequence = function() {
			return getIndexSequence().map(function(i){return indexToChar(i);}).join('');
		}
		
		//returns a list with the cluster index for each vector in the original list
		function getIndexSequence() {
			var clusterIndices = [];
			for (var i = 0; i < clusters.length; i++) {
				for (var j = 0; j < clusters[i].length; j++) {
					clusterIndices[clusters[i][j]] = i;
				}
			}
			return clusterIndices;
		}
		
		this.getClusters = function() {
			return clusters;
		}
		
		this.getClusterElements = function(index) {
			return clusters[index];
		}
		
		//returns the fragment index of a random element of a cluster
		this.getRandomClusterElement = function(char) {
			var clusterElements = clusters[charToIndex(char)];
			return clusterElements[Math.floor(Math.random()*clusterElements.length)];
		}
		
		function indexToChar(index) {
			return String.fromCharCode(FIRST_CHAR+index);
		}
		
		function charToIndex(char) {
			return char.charCodeAt(0)-FIRST_CHAR;
		}
		
	}
	
	global.Clustering = Clustering;
	
})(Kmeans);