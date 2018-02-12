(function () {
	'use strict';
	
	angular.module('audioDream.directives')
		.directive('clusterBubbles', ['d3', function(d3) {
			return {
				restrict: 'EA',
				scope: {
					data: "=",
					playing: "="
				},
				link: function(scope, iElement, iAttrs) {
					var svg = d3.select(iElement[0])
						.append("svg")
						/*.attr("width", "100%")
						.attr("height", "100%");*/
						//responsive SVG needs these 2 attributes and no width and height attr
						.attr("preserveAspectRatio", "none")
						.attr("viewBox", "0 0 600 400")
						//class to make it responsive
						.classed("svg-content", true); 
					
					var width = 600;
					var height = 400;
					var padding = 0;
					
					var xScale, yScale, sizeScale, colorScale;
					
					// on window resize, re-render d3 canvas
					window.onresize = function() {
						return scope.$apply();
					};
					scope.$watch(function(){
							return angular.element(window)[0].innerWidth;
						}, function(){
							return scope.render(scope.data);
						}
					);
					
					// watch for data changes and re-render
					scope.$watch('data', function(newVals, oldVals) {
						return scope.render(newVals);
					}, true);
					
					scope.$watch('playing', function(newVals, oldVals) {
						var toSelect = newVals.filter(function(i) {return oldVals.indexOf(i) < 0;});
						var toDeselect = oldVals.filter(function(i) {return newVals.indexOf(i) < 0;});
						
						var circles = svg.selectAll("circle");
						circles//.filter(function(d) { return toDeselect.indexOf(d) >= 0 })
						.transition()
							.duration(30)
							.style("fill", getHsl)
							.style("opacity", 0.2);
						
						circles.filter(function(d) { return toSelect.indexOf(d) >= 0 })
						.transition()
							.duration(30) // time of duration
							.style("fill", "white")
							.style("opacity", 0.9);
					}, true);
					
					// define render function
					scope.render = function(data, changedSelection){
						// setup variables
						//var width = d3.select(iElement[0])[0][0].offsetWidth - 20; // 20 is for paddings and can be changed
						// set the height based on the calculations above
						//var height = d3.select(iElement[0])[0][0].offsetHeight - 20; // 20 is for paddings and can be changed
						
						xScale = d3.scale.linear().domain([-3, 3]).range([padding, width-padding-100]),
						yScale = d3.scale.linear().domain([-3, 3]).range([height-padding, padding+100]),
						sizeScale = d3.scale.linear().domain([-3, 3]).range([5, 40]),
						colorScale = d3.scale.linear().domain([-3, 3]).rangeRound([0, 360]);
						
						var circles = svg.selectAll("circle").data(data);
						
						circles.enter()
							.append("circle")
							.on("click", function(d, i){return scope.onClick({item: d});})
							.style("fill", getHsl)
							.style("opacity", 0.2)
							.attr("r", 0)
							.attr("cx", getXValue)
							.attr("cy", getYValue)
							.transition()
								.duration(30) // time of duration
								.attr("r", getR); // width based on scale
						
						circles
							.transition()
								.duration(30) // time of duration
								.style("fill", getHsl)
								.style("opacity", 0.2)
								.attr("r", getR) // width based on scale
								.attr("cx", getXValue)
								.attr("cy", getYValue);
						
						circles.exit().remove();
						
					};
					
					
					function getXValue(d, i) {
						return xScale(d.vector[0]);//d.clusterIndex); d.vector[3]);
					}
					
					function getYValue(d, i) {
						return yScale(d.vector[d.vector.length-2]);
					}
					
					function getR(d) {
						return sizeScale(d.vector[d.vector.length-1]);
					}
					
					function getHsl(d) {
						/*if (scope.playing.indexOf(d["@id"]) >= 0) {
							return "black";
						}*/
						return "hsl(" + colorScale(d.vector[4]) + ", 80%, 50%)";
					}
					
					function getRgb(d) {
						var color = "rgb(" + colorScale(getVisualValue(d, scope.viewconfig.color.param, "color")) + ","
							+ (255-colorScale(getVisualValue(d, scope.viewconfig.color))) + ","
							+ colorScale(getVisualValue(d, scope.viewconfig.color)) +")";
						return color;
					}
					
					function getVisualValue(dymo, parameter, key) {
						if (parameter.name == "random") {
							if (!prevRandomValues[dymo["@id"]]) {
								prevRandomValues[dymo["@id"]] = {};
							}
							if (!prevRandomValues[dymo["@id"]][key]) {
								prevRandomValues[dymo["@id"]][key] = Math.random() * parameter.max;
							}
							return prevRandomValues[dymo["@id"]][key];
						} else {
							if (prevRandomValues[dymo["@id"]] && prevRandomValues[dymo["@id"]][key]) {
								delete prevRandomValues[dymo["@id"]][key];
							}
							if (dymo[parameter.name]) {
								//not suitable for vectors!! (just takes the first element..)
								var value = dymo[parameter.name].value;
								if (value.length) {
									value = value[0];
								}
								return value;
							}
							return 0;//0.00000001; //for log scale :(
						}
					}
					
				}
			};
		}]);

}());
