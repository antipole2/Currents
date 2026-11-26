// configurations
const stepTime = 0.5;		// time in hours between interpolated points
const errorDegrees = 0.25;	// find heading within this number of degrees
const minPredictionLength = 2;	// minimum distance of leg we can predict for in nm
var annouceTime = 3000;		// default time in seconds for announcement duration

// housekeeping and updates
const scriptName = "Currents";
var scriptVersion = 0.1;
require("pluginVersion")(4.1);
require("checkForUpdate")(scriptName, scriptVersion, 5, "https://raw.githubusercontent.com/antipole2/Currents/main/version.JSON");
consoleName(scriptName);
consolePark();

// extensions
Route = require("Route");
Route = extendedRouteConstructor(Route);	// extend Route to handle cb
contextSubMenu = require("contextSubMenu");
require("mouseEvents");
announcer = require("announcer")();

trace = false;
traceIteration = false;

// declarations start
var mouseId;		// id of the onMouseEvent
var contexMenuId;	// id of the context menu
var steerId;		// id of the steer announcement
var etaId;		// id of the eta announcement
var showId;		// id of shows
var cachedRoute = {};	// what it says
cachedRoute.GUID = false;

mouseId = OCPNonAllMouseEvent(mouseEvent, RIGHT_DOWN, true);

function mouseEvent(click, where, what){
	// see flowchart in technical description for the logic here
	if (what.objectType != ROUTE_SEGMENT){
		return;
		}
	//	OCPNonMouseEvent(mouseId);	// hold off further mouse clicks
	OCPNonRouteContextMenu(contexMenuId);	// cancel any left over menu
	var menu = new contextSubMenu();
	menu.subMenu = [];
	//	var route = new Route();
	//	route.getWithCb(what.GUID);
	var route = getRoute(what.GUID);
	if (trace) print("Got route ", route.name, " with cb ", route.cb, "\n");
	if (route.cb == false) menu.add(routeSelected, "Select for current planning");
	else if (route.cb.state == "ICC"){ // we are on a predicted course
		if (route.isActive) menu.add(updatePrediction, "Update prediction");
		else {
			menu.add(insertPredicted, "Insert into route");
			menu.add(regeneratePrediction, "Regenerate prediction", 5);
			menu.add(deletePrediction, "Delete prediction", 10);
			menu.add(showPredictionInfo, "Show prediction info", 20);
			}
		}
	else {
		var points = route.waypoints;
		if (route.isActive){
			var activePoint = OCPNgetSingleWaypoint(OCPNgetActiveWaypointGUID());
			if (unStashCb(activePoint.description)){ // active point is a prediction				
				menu.add(updatePrediction, "Update prediction");
				}
			else {
				if (hasCustomSpeed(points)) menu.add(resetRoute, "Reset speeds to plan default", 10);
				}
			}
		else {
			// check if route includes custom speeds
			if (hasCustomSpeed(points)) menu.add(resetRoute, "Reset speeds to plan default", 10);
			// Are we on a prediction section?
			var indexBefore = getPointBefore(points, where);
			var cb = unStashCb(points[indexBefore].description);
			if (cb){
				menu.add(extractPrediction, "Extract prediction", 1);
				}
			else {
				// Is this point eligable for prediction?
				var nextPosition = points[points.length-1].position;
				var distNextPosition = OCPNgetVectorPP(where, nextPosition).distance;
				if (distNextPosition > minPredictionLength)
				menu.add(createPrediction, "Create prediction");
				}
			menu.add(showRouteInfo, "Show route info", 20);
			}
		}
	if (menu.subMenu.length > 0){
		contexMenuId = OCPNonAllRouteContextMenu(menu, "Currents");
		}
	}

// handlers for sub-menu callbacks

function routeSelected(what){
	if (trace) print("Entered routeSelected what.GUID:", what.GUID,"\n");
	alert(false);
	var route = getRoute(what.GUID);
	if ((typeof route.name == "undefined") || (route.name== "")){
		announcer.add("Selected route must have a name", 30);
		listenForClick();
		return;
		}
	var choice = messageBox("Make working copy?", "YesNo", "Currents");
	switch (choice){
		case 0:
		case 1: {announcer("Alert A", 5); return;}
		case 2:  // set up a fresh working copy
		route.isVisible = false;
		route.update();	// hide original
		route.isVisible = true;	// will show the copy
		delete route.GUID;		// force creation of new copy
		for (var point in route.waypoints) delete route.waypoints[point].GUID;	// force new points too
		route.name += " Currents working";
		announcer.add("Route '" + route.name + "' created and orginal hidden", 10);
		break;
		case 3:
		announcer.alert("Route '" + route.name + "' ready for current planning", 10);	
		}
	if (route.plannedSpeed == 0){
		announcer.alert("Route '" + route.name + "' has a planned speed of zero - fix", 10);
		return;
		}
	setETDs(route, fromPoint = 0, route.plannedDeparture);
	route.cb = createCb("NCP");
	route.addWithCb();
	if (trace) print("Route cb: ", route.cb, "\n");	
	}

function createPrediction(what){
	// create prediction for a leg
	if (trace) print("Entered createPrediction - what is ", what, "\n");
	alert(false);
	var route = getRoute(what.GUID);
	//	var route = new Route();
	//	route.getWithCb(what.GUID);
	if (route.plannedSpeed == 0){
		announcer.alert("Route '" + route.name + "' has a planned speed of zero - fix", 10);
		listenForClick();
		return;
		}
	var waypoints = route.waypoints;
	var startPoint = getPointBefore(waypoints, what);
	var legDistance = OCPNgetVectorPP(waypoints[startPoint].position, waypoints[startPoint+1].position).distance;
	if (legDistance < stepTime*route.plannedSpeed*2){
		announcer.add("Chosen leg too short - " + Number(legDistance.toFixed(2)) + "nm", 30);
		listenForClick();
		return;
		}
	
	setETDs(route);
	if (trace) print("Done setting departure times\n");
	plan(route, startPoint);	// plan from this point
	collectGarbage();
	}

function insertPredicted(what){
	var predicted = getRoute(what.GUID);
	//	var predicted = new Route();
	//	predicted.getWithCb(what.GUID);
	if (trace) print("Entered insert predictedroute GUID ", what.GUID, "\n");
	//print(predicted, "\n");
	var pcb = predicted.cb;
	if (pcb.state != "ICC") throw("insertPredicted call wrong");
	var route = new Route();
	route.getWithCb(pcb.routeGUID);
	/*
	if (hashOfRoute(route) != route.cb.hash){	// route has been mosified
	var choice = 	choice = messageBox("Route " + route.name + " has been modified\nProceed?", "YesNo", "Currents");
	if (choice != 2) return;
	}
	*/
	var waypoints = route.waypoints;	
	// remove any existing insert
	var start = findPointInWaypoints(waypoints, pcb.fromGUID) + 1; // the start of possible existing points as offset
	
	//remove any existing inserted section
	while (unStashCb(waypoints[start].description).state == "CCB") waypoints.splice(start, 1);	// remove points
	
	var before = waypoints.slice(0, start);
	var after = waypoints.splice(start);
	if (trace) print(before[before.length-1].markName, "\n")
	if (trace) printBlue(after[0].markName, "\n");
	waypoints = before.concat(predicted.waypoints, after); //insert prediction
	if (trace) print("Inserted ", waypoints.length, " points\n");
	route.waypoints = waypoints;
	if (trace) print("Route '", route.name, "' with GUID ", route.GUID, " now has ", route.waypoints.length, " points\n\n");
	route.updateWithCb();
	predicted.delete();
	displayInfoForRoute(route, start+1);
	//	var eta = getETA(waypoints, route.plannedSpeed, route.plannedDeparture, 0);
	
	//	reportETA(waypoints, route.plannedSpeed, route.plannedDeparture, 0);
	collectGarbage();
	}

function updatePrediction(what){	// update prediction with real-time position
	var route = getRoute(what.GUID);
	//	var route = new Route();
	//	route.getWithCb(what.GUID);
	/*
	if (hashOfRoute(route) != route.cb.hash){	// route has been mosified
	var choice = messageBox("Route " + route.name + " has been modified\nProceed?", "YesNo", "Currents");
	if (choice != 2) return;
	}
	*/
	var points = route.waypoints;
	var index = getPointBefore(points, what);
	var startWp = points[index];
	// find end of forecast
	var nextIndex = index;
	while ((nextIndex < points.length-1) && unStashCb(points[nextIndex].description)) {nextIndex++;}
	var endWp = points[nextIndex];
	// synthesise a wp for where we are now
	var navigation = OCPNgetNavigation();
	var hereWp = copyObject(startWp);
	hereWp.position = navigation.position;
	var time = navigation.fixTime;
	if (isNaN(navigation.HDT))time = startWp.estimatedDeparture; // must be simulating - pick what is available
	var headingToTarget  = OCPNgetVectorPP(hereWp.position, endWp.position).bearing;
	var stw = hereWp.plannedSpeed;
	var choices = [2.0, (Math.round(stw*2*10))/10];	// round to 1 decimal place
	var dialog = [
		{type:"text", value:"Estimate speed through water"},
		{type:"spinner", range:choices, value:(Math.round(stw*10))/10, label:"knots"},
		{type:"button", label:["*Choose"]}
		];
	var choice = modalDialogue(dialog);
	stw = choice[1].value; //now have confirmed value for stw
	
	//	var forecast = generatePrediction(hereWp, endWp, stw, stepTime, doCurrents=true);
	forecast.unshift(hereWp);	// revised track to pass through where we are
	if (route.cb.state == "ICC"){ // this is a free-standing prediction
		route.updateWithCb();
		}
	else { // This is a section of a route to be replaced
		var before = points.slice(0, index); // keep these parts
		var after = points.splice(nextIndex);
		if (trace) print(before[before.length-1].markName, "\n")
		if (trace) printBlue(after[0].markName, "\n");
		points = before.concat(forecast, after); //insert prediction
		if (trace) print("Inserted ", forecast.length, " points\n");
		route.waypoints = points;
		if (trace) print("Route '", route.name, "' with GUID ", route.GUID, " now has ", route.waypoints.length, " points\n\n");
		route.updateWithCb();
		reportETA(points, route.plannedSpeed, time, index+2);
		}
	collectGarbage();
	}

function extractPrediction(what){
	var route = getRoute(what.GUID);
	//	var route = new Route();
	//	route.getWithCb(what.GUID);
	var waypoints = route.waypoints;
	var indexStart = getPointBefore(waypoints, what);	
	var indexEnd = indexStart;
	// back up to start of prediction
	while (indexStart > 0){
		if (unStashCb(waypoints[indexStart-1].description)) indexStart--;
		else break;
		}
	// now find the end
	while ((indexEnd < waypoints.length-1) && unStashCb(waypoints[indexEnd+1].description)) {
		indexEnd++;
		}
	if (trace) print("Range of prediction from ", indexStart, " to ", indexEnd, "\n");
	if ((indexEnd - indexStart) < 2) throw("extractPredictions called with no prediction insert");
	var predicted = new Route();	// this will be the extracted prediction
	predicted.name = "Predicted";
	predicted.isVisible = true;
	predicted.colour = "Magenta";
	predicted.penStyle = 101; // dashed line
	predicted.cb = createCb("ICC"); // control block for prediction
	predicted.cb.routeGUID = route.GUID;
	if ((indexStart < 1) || (indexEnd == waypoints.length-1)) throw("extractPrediction index logic error");
	predicted.cb.fromGUID = waypoints[indexStart-1].GUID;	// where it belongs in the parent route
	predicted.cb.toGUID = waypoints[indexEnd+1].GUID;
	predicted.waypoints = waypoints.splice(indexStart, indexEnd-indexStart+1);
	// line above also removes predicted from waypoints
	predicted.addWithCb();
	route.updateWithCb();
	collectGarbage();
	};

function regeneratePrediction(what){
	// we have a free-standing prediction to regenerate
	var predicted = getRoute(what.GUID);
	//	var predicted = new Route();
	//	predicted.getWithCb(what.GUID);
	var route = new Route();
	route.getWithCb(predicted.cb.routeGUID);	// get the parent route
	var fromPoint = findPointInWaypoints(route.waypoints, predicted.cb.fromGUID);
	predicted.delete();
	plan(route, fromPoint);
	collectGarbage();
	}

function resetRoute(what){ // resets route
	if (trace) print("Resetting route\n");
	var route = getRoute(what.GUID);
	//	var route = new Route();
	//	route.getWithCb(what.GUID);	// get latest
	var waypoints = route.waypoints;
	if (havePredictions(waypoints)){
		var choice = messageBox("Route has predictions.  Remove and reset?", "YesNo", "Currents");
		if (choice != 2) return;
		// we reverse up the waypoints so we can delete some as we go
		for (var p = waypoints.length-1; p > 1; p--){
			if (unStashCb(waypoints[p].description))	waypoints.splice(p, 1);
			}
		}
	var p; var len;
	for (p = 0, len = waypoints.length; p < len; p++){
		if (waypoints[p].plannedSpeed != 0){
			waypoints[p].plannedSpeed = 0;
			OCPNupdateSingleWaypoint(waypoints[p]);
			}
		}
	setETDs(route);
	route.cb.state = "NCP";
	route.cb.hash = hashOfRoute(route);
	route.updateWithCb();
	collectGarbage();
	}

function deletePrediction(what){	// delete free-sanding prediction
	OCPNdeleteRoute(what.GUID);
	}

function showPredictionInfo(what){
	var route = getRoute(what.GUID);
	displayInfoForPrediction(route);
	}

function showRouteInfo(what){
	var route = getRoute(what.GUID);
	var prevPoint = getPointBefore(route.waypoints, what);
	var eta = setETDs(route, prevPoint, route.plannedDeparture);
	announcer.cancel(etaId);
	displayInfoForRoute(route, prevPoint);
	announcer.cancel(etaId);
	etaId = announcer.add("ETA " + new Date(eta*1000).toUTCString(), annouceTime);	
	}


// Helper functions

function plan(route, fromPoint){	// create current predicted legs starting from index fromPoint
	var toPoint = fromPoint + 1;	// to next point
	if (trace) print("Planning for route: ", route.name, " Planned speed: ", route.plannedSpeed,"\n");
	var startWp = route.waypoints[fromPoint];
	var endWp = route.waypoints[toPoint];
	var stw = (endWp.plannedSpeed == 0) ? route.plannedSpeed : endWp.plannedSpeed;	// speed through water to next point
	var overallVector = OCPNgetVectorPP(startWp.position, endWp.position);
	// Check whether we have current predictions available
	// They might be missing close inshore at beginning and end, so use mid-point
	var halfVector = {bearing:overallVector.bearing, distance:overallVector.distance/2};
	var midPosition = OCPNgetPositionPV(startWp.position,halfVector);
	var midTime = (startWp.estimatedDeparture + endWp.estimatedDeparture)/2;
	var current = getCurrent(midPosition, midTime*1000);
	if (typeof current != "object"){
		announcer.add(argsToString("Mid position ",
				new Position(midPosition).formatted, " ", current,
				"\nCheck you have a valid grib for this area and time"), 60);
		return;
		}
	if (trace) print("Starting at: ", startWp, "\nEnding at: ", endWp, "\n");
	var forecast = generatePrediction(startWp, endWp, stw, stepTime, doCurrents=true);
	var predicted = new Route();
	predicted.plannedSpeed = stw;
	predicted.name = "Predicted";
	predicted.waypoints = forecast;
	predicted.isVisible = true;
	predicted.colour = "Magenta";
	predicted.penStyle = 101; // dashed line
	var cb = createCb("ICC"); // control block for prediction
	cb.routeGUID = route.GUID;
	cb.fromGUID = startWp.GUID;	// where it belongs in the parent route
	cb.toGUID = endWp.GUID;
	var pointCb = unStashCb(forecast[0].description);
	cb.steer = pointCb.steer;
	predicted.cb = cb;
	predicted.addWithCb();
	if (trace) print("Predicted cb: ", cb, "\n");
	if (route.cb.state == "NCP"){ // first prediction
		route.cb.state = "HCP";
		}
	route.updateWithCb();
	var eta = setETDs(route, fromPoint = 0, route.plannedDeparture);
	announcer.cancel(etaId);
	etaId = announcer.add("ETA " + new Date(eta*1000).toUTCString(), annouceTime);
	}

function generatePrediction(startWp, endWp, stw, stepTime, doCurrents){
	// returns routepoints being prediction
	var targetBearing = OCPNgetVectorPP(startWp.position, endWp.position).bearing;
	var steer = targetBearing;
	for (var iteration = 1; iteration <= 4; iteration++){	// we iterate to tune the outcome
		var forecast = createForecastSegment(startWp, endWp, steer, stw, stepTime, doCurrents, iteration);
		
		if (false){	// only when debugging
			print("Forecast has ", forecast.length, " points\n");
			// we will display each iteration
			var predicted = new Route();
			predicted.name = "Predicted iteration " + iteration;
			predicted.waypoints = forecast;
			predicted.isVisible = true;
			predicted.colour = "Magenta";
			predicted.penStyle = 101; // dashed line
			OCPNaddRoute(predicted);
			}
		var newBearing = OCPNgetVectorPP(startWp.position, forecast[forecast.length-1].position).bearing;
		var error = targetBearing - newBearing;
		if (traceIteration) print("Iteration ", iteration, " target bearing ", steer, "\tended with ", newBearing, " error: ", error,"\n");
		if (Math.abs(error) <= errorDegrees) break; // ************************
		steer += error;
		if (steer > 360) steer -= 360;
		if (steer < 0) steer += 360;
		if (traceIteration) print("Iteration ", iteration, " Adjusting to steer: ", steer, "\n");
		}
	//  Need to ensure last point splices into original route
	var finalVector = OCPNgetVectorPP(forecast[forecast.length-2].position, forecast[forecast.length-1].position);
	var vectorToEndWp = OCPNgetVectorPP(forecast[forecast.length-1].position, endWp.position);
	if (trace) printBlue("Drop last? vectorToEndWp:", vectorToEndWp, "\thalf step:", stw*stepTime/2, "\tfinalVector.bearing:", finalVector.bearing, "\n");
	if ((vectorToEndWp.distance < stw*stepTime/2) // less than half a step)
		|| (Math.abs(finalVector.bearing - vectorToEndWp.bearing) > 90)){	// limit in change of direction (degrees)
		if (trace) print("Dropping last point\n");
		forecast.pop();	// drop last point
		}
//	announcer.cancel(steerId);
//	steerId = announcer.add("Course to steer " + steer.toFixed(0) + "ºT though the water", 6000);
	return forecast;
	}

function getCurrent(where, when){	// time is Unix time
	var time = new Date(when);
	if (trace) print("Entered getCurrent in position ", where, " at " , time, "\n");
	var 	toSend = {
		"Year": time.getFullYear(),
		"Month": time.getMonth(),
		"Day": time.getDate(),
		"Hour": time.getHours(),
		"Minute": time.getMinutes(),
		"Second": time.getSeconds(),
		"lat": where.latitude,
		"lon": where.longitude,
		"CURRENT SPEED": 0};
	var ctrace = false;
	if (ctrace) print("getCurrent to send: ", toSend, "\n");
	var reply = OCPNsendMessage("GRIB_VALUES_REQUEST", JSON.stringify(toSend));
	if (ctrace) printOrange("Reply: ", reply, "\n");
	if (ctrace){
		print("GRIB response: '" , reply, "'\n");
		}
	if (!reply) return (scriptName + " - GRIB plugin not active and responding");
	var parsed = JSON.parse(reply);
	if (parsed["CURRENT DIR"] == undefined){		
		return(" getCurrent - no current data at " + new Position(where).formatted + " for " + new Date(when));
		}
	parsed["CURRENT DIR"] = flip(parsed["CURRENT DIR"]);	// -> direction of flow
	parsed["CURRENT SPEED"] *= 1.943844;	// m/s to knots	
	//	print(JSON.stringify(parsed, null, "\t"), "\n");
	return({"direction": parsed["CURRENT DIR"], "speed": parsed["CURRENT SPEED"]});
	}

function createForecastSegment(startWp, targetWp, steer, stw, stepTime, doCurrents, iteration){
	// return a waypoint array being forecast path from startWp towards targetWp
	// (startWp must include plannedDeparture time in seconds since 1 Jan 1970)
	// stw is speed through water in knots
	// what to steer through water
	// stepTime is duration of each step in hours
	// if doCurrents true, adjust for currents	
	if (trace){ print("Entered createForecastSegment\n");
		print("From: ", startWp.position, " to ", targetWp.position, " at ", stw, "kn step time: ", stepTime, "hrs doCurrents: ", doCurrents, "\n");
		}	
	var forecast = [];	//to be the array of points
	var overallVector = OCPNgetVectorPP(startWp.position, targetWp.position);
	var distanceToGo = overallVector.distance;
	var stepVector = {bearing:steer, distance: stw*stepTime};
	var halfStepVector = {bearing: stepVector.bearing, distance: stepVector.distance/2};
	var lastWp = startWp;
	var step = 0;
	var missingCurrent = 0;
	const missingCurrentLimit = 5;
	var iterations = 0;
	var currentVector = {"bearing":0,"distance":0};
	var lastCurrentVector = currentVector;
	var stepTimeSecs = stepTime*60*60;
	do {
		var nextWp = copyObject(lastWp);
		nextWp.markName= "Step " + ++step;
		nextWp.plannedSpeed = stw;
		delete nextWp.GUID;
		nextWp.position = OCPNgetPositionPV(lastWp.position,stepVector);
		nextWp.estimatedDeparture += stepTimeSecs;
		nextWp.isVisible = false;
		nextWp.minScale = 100000;
		nextWp.useMinScale = true;	// normlly true
		var cb = createCb("CCB");
		if (doCurrents){ // adjust for current
			var thisStepVector = OCPNgetVectorPP(lastWp.position, nextWp.position);
			thisStepVector.distance = thisStepVector.distance/2; // half it
			var midPosition = OCPNgetPositionPV(lastWp.position, thisStepVector);
			var midTime = (lastWp.estimatedDeparture + nextWp.estimatedDeparture)/2;
			if (trace) printBlue("midTime: ", midTime, "\t", new Date(midTime*1000), "\n");
			var current = getCurrent(midPosition, midTime*1000);
			if (trace) print("step ", step, "\tCurrent: ", current, "\n");
			var currentVector;
			if (typeof current == "object"){ // we have a current
				//				var stepLegTime = (nextWp.estimatedDeparture - lastWp.estimatedDeparture)/(60*60);	// in hours
				currentVector = {bearing: current.direction, distance: (current.speed * stepTime)};
				lastCurrentVector = currentVector; // remember in case next is missing
				}
			else {
				currentVector = lastCurrentVector;	// use last instead
				if (iteration == 1){
					announcer.add(current, 60);
					}
				if (missingCurrent++ > missingCurrentLimit){
					announcer.add("More than ", missingCurrentLimit, " missing currents - abandoning forecast", 60);
					return forecast;
					}
				}
			nextWp.position = OCPNgetPositionPV(nextWp.position, currentVector); // adjust for current offset
			}
		cb.steer = steer.toFixed(0);
		cb.currentVector = {bearing:(currentVector.bearing.toFixed(1)), distance:(currentVector.distance.toFixed(2))};
		nextWp.description = stashCb(nextWp.description, cb);
		if (trace) print("Step ", step, "\tcurrent vector ", cb.currentVector, "\n");
		var newDistanceToGo = OCPNgetVectorPP(nextWp.position, targetWp.position).distance;
		if (newDistanceToGo >= distanceToGo) break;	// past nearest point
		// Not on last iteration
		if (missingCurrent) announcer.add(missingCurrent, 10);
		distanceToGo = newDistanceToGo;
		forecast.push(nextWp);
		lastWp = nextWp;
		if (trace) print("CreateForecastSegement at end of do loop ", lastWp, "\n");
		} while  (++iterations);	//relies on break to exit loop
	return(forecast);
	}

function setETDs(route, startPoint, startTime){
	// set the EDT times in a route
	// returns arrival time in seconds
	var routeSpeed = route.plannedSpeed;
	var legSpeed;
	var arrivalTime;
	var stepSeconds = stepTime*60*60;
	var waypoints = route.waypoints;
	waypoints[0].estimatedDeparture = route.plannedDeparture;
	// print("Route planned departure: ", new Date(route.plannedDeparture*1000).toUTCString(), "\n");
	OCPNupdateSingleWaypoint(waypoints[0]);
	var p; var len;
	for (p = startPoint+1, len = waypoints.length; p < len; p++){
		var cb = unStashCb(waypoints[p].description);
		if (cb){ // this is predicted
			arrivalTime = waypoints[p].estimatedDeparture = waypoints[p-1].estimatedDeparture + stepSeconds;
			}
		else {
			var legSpeed = (waypoints[p].plannedSpeed == 0) ? routeSpeed : waypoints[p].plannedSpeed;
			var legLength = OCPNgetVectorPP(waypoints[p-1].position, waypoints[p].position).distance;
			arrivalTime = waypoints[p].estimatedDeparture = waypoints[p-1].estimatedDeparture + legLength/legSpeed*60*60;
			// print(p, "\tspeed:", legSpeed, "\tlength", legLength, "\ttime", new Date(arrivalTime*1000).toUTCString(), "\n");
			}
		if (trace) print(p, "\tLength: ", legLength, "\tSpeed: ", legSpeed, "\tETD: ", waypoints[p].estimatedDeparture, "\n");
		OCPNupdateSingleWaypoint(waypoints[p]);
		}
	return arrivalTime;
	}

function findPointInWaypoints(waypoints, pointGuid){ // returns offset of routepoint in waypoints with given GUID
	var p; var len;
	for (p = 0, len = waypoints.length; p < len; p++){
		if (waypoints[p].GUID == pointGuid) return p;
		}
	throw("findPointInRoute called with non-existant point GUID");
	}

function havePredictions(waypoints){	// check if waypoints include predictions;
	var p; var len;
	for (p = 0, len = waypoints.length; p < len; p++){
		if (unStashCb(waypoints[p].description)) return true;
		}
	return false;
	}

function hasCustomSpeed(points){ // check if includes custom speeds
	var found = false;
	var p; var len;
	for (p = 0, len = points.length; p < len; p++){		if (points[p].plannedSpeed != 0) return true;
		}
	return false}

function getETA(waypoints, plannedSpeed, startTime, fromIndex){
	// planned speed - route planned speed as default
	// startTime - time from which we start
	// index from which to calculate
	var eta = startTime;
	var p; var len;
	for (p = 0, len = waypoints.length-1; p < len; p++){ // NB this omits last  
		var stw = waypoints[p].plannedSpeed;	// speed through water
		if (stw == 0) stw = plannedSpeed;
		if (!unStashCb(waypoints[p].description)){ // not a prediction
			var distance = OCPNgetVectorPP(waypoints[p].position, waypoints[p+1].position).distance;
			eta += distance/stw*60*60;
			}
		else {	// this is predicted leg
			eta += stepTime*60*60;
			}
		}
	return eta;
	}

function displayInfoForRoute(route, fromPoint){
	var waypoints = route.waypoints;
/*	var startTime = waypoints[0].estimatedDeparture;
	var endTime = waypoints[waypoints.length-1].estimatedDeparture;
	var duration = (endTime - startTime)/(60*60);	// in hours
	var message = argsToString("Route from ",
		new Date(startTime*1000).toUTCString()," to ",
		new Date(endTime*1000).toUTCString()," (", duration.toFixed(2), "hrs)\n");
*/
	var cb = unStashCb(waypoints[fromPoint].description);
	var message = "";
	if (cb){message += "Steer " + cb.steer + "ºT throughout predicted section";}
	else {
		var vector = OCPNgetVectorPP(waypoints[fromPoint].position, waypoints[fromPoint+1].position);
		message += "Bearing to next routepoint: " + vector.bearing.toFixed(0) + "ºT";
		}
	announcer.cancel(showId);
	showId = announcer.add(message, 3000);
	}

function displayInfoForPrediction(route){
	var waypoints = route.waypoints;
	var startTime = waypoints[0].estimatedDeparture;
	var endTime = waypoints[waypoints.length-1].estimatedDeparture;
	var duration = stepTime * waypoints.length;
	var cb = unStashCb(waypoints[0].description);
	var steer = cb.steer;
	var message = argsToString("Prediction from ",
		new Date(startTime*1000).toUTCString()," to ",
		new Date(endTime*1000).toUTCString()," (", duration, "hrs)\n",
		"Steer ", steer, "ºT throughout");
	announcer.cancel(showId);
	showId = announcer.add(message, 3000);
	}

function getPointBefore(waypoints, position){
	// Return index of waypoint before the closest segment	
	var maxDistance = Number.MAX_VALUE;
	var pBefore;
	var len;
	for (var p = 0, len = waypoints.length - 1; p < len; p++){ // does not iterate to last
		var a = waypoints[p].position;
		var b = waypoints[p+1].position;
		var cosLat = Math.cos(a.latitude * Math.PI/180);
		
		// Northing and easting of b from a
		var nb = 60 * (b.latitude - a.latitude);
		var eb = 60 * (b.longitude - a.longitude) * cosLat;
		
		// Northing and easting of position from a
		var nw = 60 * (position.latitude - a.latitude);
		var ew = 60 * (position.longitude - a.longitude) * cosLat;
		
		var lengthSquared = eb*eb + nb*nb;
		if (lengthSquared == 0) continue;
		
		// Project position onto segment ab
		var t = (eb*ew + nb*nw) / lengthSquared;
		
		// Clamp projection to the segment
		t = Math.max(0, Math.min(1, t));
		
		// Distance from position to closest point on segment
		var de = ew - t*eb;
		var dn = nw - t*nb;
		var d = Math.sqrt(de*de + dn*dn);
		
		if (d < maxDistance){
			pBefore = p;
			maxDistance = d;
			}
		}	
	return pBefore;
	}

function currentVectorToString(vector){
	if (trace) print(vector, "\n");
	// format vector as nice string for display
	var result = {};
	result.distance = vector.distance.toFixed(2);	
	if (vector.distance != 0) result.bearing = vector.bearing.toFixed(1);
	return JSON.stringify(result);
	}

function extendedRouteConstructor(Route){	// returns extended Route constructor
	// adds cb attribute amd methods to stash or unstash it from the description field
	// when stored in OpenCPN
	// this is provided in a functanion so we can place it well down the script out of first sight
	Route.prototype.cb = false;
	
	Route.prototype.getWithCb = function(GUID){ // get route and unstash any cb
		var basicRoute = this.get(GUID);
		if (!basicRoute) throw("getWithCb called on non-existant route");
		var cb = unStashCb(this.description);
		if (cb) this.cb = cb;
		return true;
		}
	
	Route.prototype.updateWithCb = function(){ // update including cb
		this.cb.hash = hashOfRoute(this);
		this.description = stashCb(this.description, this.cb);
		cachedRoute = this;
		return this.update();
		}
	
	Route.prototype.addWithCb = function(){ // add route with cb;
		this.cb.hash = hashOfRoute(this);
		this.description = stashCb(this.description, this.cb);
		cachedRoute = this;
		return this.add(this.GUID);
		}
	
	return Route;
	} 

function getRoute(guid){ // fetches route - maybe from cache
	if (guid == cachedRoute.GUID) {
		if (trace) print("Getting cached route\t", guid, "\n");
		return cachedRoute;
		}
	if (trace) print("Getting fresh route\t", guid, "\n");
	var route = new Route();
	route.getWithCb(guid);
	cachedRoute = route;
	return route;
	}

function flip(direction){
	return((direction >= 180) ? direction - 180 : direction + 180);
	}

function copyObject(what){
	return (JSON.parse(JSON.stringify(what)));
	}

function createCb(state){
	var cb= {};
	cb.state = state
	return cb;
	}

function stashCb(description, cb){
	// stash control block cb into a route or waypoint object
	
	description = description.replace(/ *cb={.*}/, ""); // drop any existing stash
	description += " cb=" + JSON.stringify(cb);
	return description;
	}

function unStashCb(description){
	// return the control block stashed in the description, else false
	var cb = false;
	var indexStart = description.search("cb={");
	if (indexStart >= 0) { //have stashed cb
		var json = cleanString(description.slice(indexStart+3));
		try {
			cb = JSON.parse(json);
			}
		catch(err){
			printRed(err, "\n");
			throw("unStashCb: invalid JSON in description cb: "+ json);
			}
		}
	return cb;
	}

function hashOfRoute(route){
	var tempCopy = copyObject(route);
	delete tempCopy.description;	//  exclude this
	return fnv1a32(tempCopy);
	}

function fnv1a32(object) { // return FNV-1a hash of object
	var bufAb = CBOR.encode(object);	// serialise
	var v = new Uint8Array(bufAb);
	var h = 0x811c9dc5; // offset basis
	for (var i = 0; i < v.length; i++) {
		h ^= v[i];
		h = (h * 0x01000193) >>> 0;
		}
	return h;
	}

