// configurtions
stepTime = 0.5;		// time in hours between interpolated points
errorDegrees = 0.25;		// find heading within this number of degrees
minPredictionLength = 2;	// minimum distance of leg we can predict for in nm

// housekeeping and updates
scriptName = "Currents";
consoleName(scriptName);

// extensions
Route = require("Route");
Route = extendedRouteConstructor(Route);	// extend Route to handle cb
contextSubMenu = require("contextSubMenu");
require("mouseEvents");

trace = false;
traceIteration = false;

// declarations start
var contexMenuId;	// to hold the id of the context menu
var menu = new contextSubMenu();

function mouseEvent(click, where, what){
	// see flowchart in technical description for the logic here
	if (what.objectType != ROUTE_SEGMENT) return;
	OCPNonRouteContextMenu(contexMenuId);	// cancel any left over menu
	menu.subMenu = [];
	route = new Route();
	route.getWithCb(what.GUID);
	if (trace) print("Got route ", route.name, " with cb ", route.cb, "\n");
	if (route.cb == false) menu.add(routeSelected, "Select for current planning");
	else if (route.cb.state == "ICC"){ // we are on a predicted course
		if (route.isActive) menu.add(updatePrediction, "Update prediction");
		else {
			menu.add(insertPredicted, "Insert into route");
			menu.add(deletePrediction, "Delete prediction", 10);
			}
		}
	else {
		var points = route.waypoints;
		activePointIsPrediction = false;
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
			if (cb) menu.add(extractPrediction, "Extract prediction", 1);
			else {
				// Is this point eligable for prediction?
				var lastPosition = points[points.length-1].position;
				var distLastPoint = OCPNgetVectorPP(where, lastPosition).distance;
				var nextPosition = points[points.length-1].position;
				var distNextPosition = OCPNgetVectorPP(where, nextPosition).distance;
				if (distNextPosition > minPredictionLength)
				menu.add(legSelected, "Create prediction");
				}
			}
		}
	if (menu.length == 0) menuAdd(noAction, "No actions");
	contexMenuId = OCPNonRouteContextMenu(menu, "Currents");
	}

function routeSelected(what){
	if (trace) print("Entered routeSelected what.GUID:", what.GUID,"\n");
	alert(false);
	route = new Route(what.GUID);
	if ((typeof route.name == "undefined") || (route.name== "")){
		announcer.alert("Selected route must have a name", 30);
		return;
		}
	choice = messageBox("Make working copy?", "YesNo", "Currents");
	printBlue("Choice: ", choice, "\n");
	if (choice == 3) return;
	// set up a fresh working copy
	route.isVisible = false;
	route.update();	// hide original
	route.isVisible = true;	// will show the copy
	delete route.GUID;		// force creation of new copy
	for (var point in route.waypoints) delete route.waypoints[point].GUID;	// force new points too
	route.name += " Currents working";
	route.cb = createCb("NCP");
	route.addWithCb();
	if (trace) print("New route cb: ", route.cb, "\n");
	announcer.alert("Route '" + route.name + "' created and orginal hidden", 10);
	if (route.plannedSpeed == 0)announcer.alert("Route '" + route.name + "' has a planned speed of zero", 10);
	}

function legSelected(what){
	// creat prediction for a leg
	if (trace) print("Entered leg selected - what is ", what, "\n");
	alert(false);
	var route = new Route();
	route.getWithCb(what.GUID);
	if (route.plannedSpeed == 0){
		announcer.alert("Route '" + route.name + "' has a planned speed of zero - fix", 10);
		return;
		}
	var points = route.waypoints;
	var startPoint = getPointBefore(points, what);
	var legDistance = OCPNgetVectorPP(points[startPoint].position, points[startPoint+1].position).distance;
	if (legDistance < stepTime*route.plannedSpeed*2){
		announcer.alert("Chosen leg too short - " + Number(legDistance.toFixed(2)) + "nm", 30);
		return;
		}
	// fix up times in route
	route.waypoints[0].estimatedDeparture = route.plannedDeparture;
	if (route.waypoints[0].plannedSpeed == 0) route.waypoints[0].plannedSpeed = route.plannedSpeed;
	lastPosition = route.waypoints[0].position;
	OCPNupdateSingleWaypoint(route.waypoints[0]);
	for (var p= 1; p < route.waypoints.length; p++){
		var legSpeed;
		if (route.waypoints[p].plannedSpeed == 0) legSpeed = route.waypoints[p].plannedSpeed = route.plannedSpeed;
		else legSpeed = route.waypoints[p].plannedSpeed;
		var thisPosition = route.waypoints[p].position;
		var legLength = OCPNgetVectorPP(lastPosition, thisPosition).distance;
		if (trace) print(p, "\t", legLength, "\t", legSpeed, "\t", route.waypoints[p].estimatedDeparture, "\n");
		lastPosition = thisPosition;
		route.waypoints[p].estimatedDeparture = route.waypoints[p-1].estimatedDeparture + legLength/legSpeed*60*60;
		if (trace) printBlue(p, "\tETD: ", route.waypoints[p].estimatedDeparture, "\n");
		OCPNupdateSingleWaypoint(route.waypoints[p]);
		}
	if (trace) print("Done setting departure times\n");
	plan(route, startPoint);	// plan from this point
	}

function plan(route, fromPoint){	// created current predicted legs starting from index fromPoint
	if (trace) print("Planning for route: ", route.name, "\n");
	// fix up speed and ETD in route
	if (trace) print("Planned speed: ", route.plannedSpeed, "\n");
	startWp = route.waypoints[fromPoint];
	endWp = route.waypoints[fromPoint+1];
	var overallVector = OCPNgetVectorPP(startWp.position, endWp.position);
	// Check whether we have current predictions available
	// They might be missig close inshore at beginning and end, so use mid-point
	var halfVector = {bearing:overallVector.bearing, distance:overallVector.distance/2};
	var midPosition = OCPNgetPositionPV(startWp.position,halfVector);
	var current = getCurrent(midPosition, startWp.estimatedDeparture*1000);
	if (typeof current != "object"){
		announcer.alert("Mid position " + current, 60);
		return;
		}
	
	missingCount = 0; // number of currents missing
	if (trace) print("Starting at: ", startWp, "\nEnding at: ", endWp, "\n");
	
	// create array of points forecast between startWp and endWp
	if (trace) print("startWp: ", startWp, "\n");
	var stw = startWp.plannedSpeed; // speed through water
	overallVector = OCPNgetVectorPP(startWp.position, endWp.position);
	targetBearing = overallVector.bearing;	// what we should stear if no current
	if (trace) print("Overall vector: ", overallVector, "\n");
	var forecast = generatePrediction(startWp, endWp, stw, stepTime, doCurrents=true);
	var predicted = new Route();
	predicted.name = "Predicted";
	predicted.waypoints = forecast;
	predicted.isVisible = true;
	predicted.colour = "Magenta";
	predicted.penStyle = 101; // dashed line
	predicted.cb = createCb("ICC"); // control block for prediction
	predicted.cb.routeGUID = route.GUID;
	predicted.cb.fromGUID = startWp.GUID;	// where it belongs in the parent route
	predicted.cb.toGUID = endWp.GUID;
	if (trace) print("Predicted cb: ", predicted.cb, "\n");
	predicted.addWithCb();
	if (route.cb.state == "NCP"){ // first prediction
		route.cb.state = "HCP";
		//		route.cb.predictions = [];
		}
	//	route.cb.predictions.push({startGUID: startWp.GUID, endGUID: endWp.GUID});
	route.updateWithCb();
	}

function generatePrediction(startWp, endWp, stw, stepTime, doCurrents){
	// returns routepoints being prediction
	var targetBearing = OCPNgetVectorPP(startWp.position, endWp.position).bearing;
	var steer = targetBearing;
	for (var iteration = 1; iteration <= 4; iteration++){	// we iterate to tune the outcome
		forecast = createForecastSegment(startWp, endWp, steer, stw, stepTime, doCurrents);
		
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
		newBearing = OCPNgetVectorPP(startWp.position, forecast[forecast.length-1].position).bearing;
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
	vectorToEndWp = OCPNgetVectorPP(forecast[forecast.length-1].position, endWp.position);
	if (trace) printBlue("Drop last? vectorToEndWp:", vectorToEndWp, "\thalf step:", stw*stepTime/2, "\tfinalVector.bearing:", finalVector.bearing, "\n");
	if ((vectorToEndWp.distance < stw*stepTime/2) // less than half a step)
		|| (Math.abs(finalVector.bearing - vectorToEndWp.bearing) > 90)){	// limit in change of direction (degrees)
		if (trace) print("Dropping last point\n");
		forecast.pop();	// drop last point
		}
	announcer.alert("Course to steer " + steer.toFixed(0) + "ºT though the water", 6000);
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
	
	//	if (trace) print("getCurrent to send: ", toSend, "\n");
	var reply = OCPNsendMessage("GRIB_VALUES_REQUEST", JSON.stringify(toSend));
	//	if (trace) printOrange("Reply: ", reply, "\n");
	if (trace){
		//		print("typeof reply: ", typeof reply, "\n");
		print("GRIB response: '" , reply, "'\n");
		}
	if (!reply) return (scriptName + " - GRIB plugin not active and responding");
	parsed = JSON.parse(reply);
	if (parsed["CURRENT DIR"] == undefined){		
		return(" getCurrent - no current data at " + new Position(where).formatted + " for " + new Date(when));
		}
	parsed["CURRENT DIR"] = flip(parsed["CURRENT DIR"]);	// -> direction of flow
	parsed["CURRENT SPEED"] *= 1.943844;	// m/s to knots	
	//	print(JSON.stringify(parsed, null, "\t"), "\n");
	return("Current: ", {"direction": parsed["CURRENT DIR"], "speed": parsed["CURRENT SPEED"]});
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
	var missingCurrentLimit = 5;
	var iterations = 0;
	var currentVector = {"direction":0,"speed":0};
	var lastCurrentVector = currentVector;
	do {
		var nextWp = copyObject(lastWp);
		nextWp.markName= "Step " + ++step;
		//		if (trace) print("Step ", step, "\n");
		delete nextWp.GUID;
		nextWp.position = OCPNgetPositionPV(lastWp.position,stepVector);
		nextWp.estimatedDeparture += stepVector.distance/stw*60*60;
		nextWp.isVisible = false;
		nextWp.minScale = 100000;
		nextWp.useMinScale = true;	// normlly true
		var cb = createCb("CCB");
		if (doCurrents){ // adjust for current
			midPosition = OCPNgetPositionPV(lastWp.position, halfStepVector);
			midTime = (lastWp.estimatedDeparture + nextWp.estimatedDeparture)/2;
			//			if (trace) printBlue("midTime: ", midTime, "\t", new Date(midTime*1000), "\n");
			var current = getCurrent(midPosition, midTime*1000);
			if (trace) print("step ", step, "\tCurrent: ", current, "\n");
			if (typeof current == "object"){ // we have a current
				var stepLegTime = (nextWp.estimatedDeparture - lastWp.estimatedDeparture)/(60*60);	// in hours
				cb.currentVector = {bearing: current.direction, distance: current.speed * stepLegTime};
				lastCurrentVector = cb.currentVector; // remember in case next is missing
				}
			else {
				cb.currentVector = lastCurrentVector;	// use last instead
				if (iteration == 1){
					announcer.alert(current, 60);
					announcer.alert("Continuing with current vector " + currentVectorToString(lastCurrentVector), 60);
					}
				if (missingCurrent++ > missingCurrentLimit){
					announcer.alert("More than " + missingCurrentLimit + " missing currents - abandoning forecast", 60);
					return forecast;
					}
				}
			nextWp.position = OCPNgetPositionPV(nextWp.position, cb.currentVector); // adjust for current offset
			}
		nextWp.description = stashCb(nextWp.description, cb);
		if (trace) print("Step ", step, "\tcurrent vector ", cb.currentVector, "\n");
		var newDistanceToGo = OCPNgetVectorPP(nextWp.position, targetWp.position).distance;
		if (newDistanceToGo >= distanceToGo) break;	// past nearest point
		// Not on last iteration
		if (missingCurrent) announcer.alert(missingCurrent, 10);
		distanceToGo = newDistanceToGo;
		//		printGreen("distanceToGo: ", distanceToGo, "\n");
		forecast.push(nextWp);
		lastWp = nextWp;
		} while  (++iterations);	//relies on break to exit loop
	return(forecast);
	}

function flip(direction){
	return((direction >= 180) ? direction - 180 : direction + 180);
	}

function copyObject(what){
	return (JSON.parse(JSON.stringify(what)));
	}

function hashOfRoute(route){
	var tempCopy = copyObject(route);
	delete tempCopy.description;	//  exclude this
	return fnv1a32(tempCopy);
	}

function createCb(state){
	cb= {};
	cb.state = state
	return cb;
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

function findPointInWaypoints(waypoints, pointGuid){ // returns offset of routepoint in waypoints with given GUID
	for (p in waypoints){
		if (waypoints[p].GUID == pointGuid) return Number(p);
		}
	throw("findPointInRoute called with non-existant point GUID");
	}

function havePredictions(waypoints){	// check if waypoints include predictions;
	for (p in waypoints){
		if (unStashCb(waypoints[p].description)) return true;
		}
	return false;
	}

function hasCustomSpeed(points){ // check if include custom speeds
	var found = false;
	for (var p in points){
		if (points[p].plannedSpeed != 0) return true;
		}
	return false}

function resetRoute(what){ // resets route
	if (trace) print("Resetting STW for route\n");
	var route = new Route();
	route.getWithCb(what.GUID);	// get latest
	var waypoints = route.waypoints;
	if (havePredictions(waypoints)){
		var choice = messageBox("Route has predictions.  Remove and reset?", "YesNo", "Currents");
		printBlue("Choice: ", choice, "\n");
		if (choice == 3) return;
		// we reverse up the waypoints so we can delete some
		for (var p = waypoints.length-1; p > 1; p--){
			if (unStashCb(waypoints[p].description))	waypoints.splice(p, 1);
			}
		}
	for (var p in waypoints){
		if (waypoints[p].plannedSpeed != 0){
			waypoints[p].plannedSpeed = 0;
			OCPNupdateSingleWaypointwaypoints[p];
			}
		}
	route.cb.state = "NCP";
	route.cb.hash = hashOfRoute(route);
	route.updateWithCb();	
	}

function extractPrediction(what){
	var route = new Route();
	route.getWithCb(what.GUID);
	if (route.cb.state != "HCP") throw ("remove PRedictoions -  Not state HCP");
	var waypoints = route.waypoints;
	var indexStart = getPointBefore(waypoints, what);	
	var indexEnd = indexStart;
	// backup to start of prediction
	while (indexStart > 0){
		if (unStashCb(waypoints[indexStart-1].description)) indexStart--;
		else break;
		}
	// now find the end
	while (indexEnd <= waypoints.length){
		if (unStashCb(waypoints[indexEnd+1].description)) indexEnd++;
		else break;
		}
	if (trace) print("Range of prediction from ", indexStart, " to ", indexEnd, "\n");
	var predicted = new Route();	// this will bethe extracted prediction
	predicted.name = "Predicted";
	predicted.isVisible = true;
	predicted.colour = "Magenta";
	predicted.penStyle = 101; // dashed line
	predicted.cb = createCb("ICC"); // control block for prediction
	predicted.cb.routeGUID = route.GUID;
	predicted.cb.fromGUID = waypoints[indexStart-1].GUID;	// where it belongs in the parent route
	predicted.cb.toGUID = waypoints[indexEnd+1].GUID;
	predicted.waypoints = waypoints.splice(indexStart, indexEnd-indexStart+1);
	// line above also removes predicted from waypoints
	predicted.addWithCb();
	route.updateWithCb();	
	};

function deletePrediction(what){	// delete free-sanding prediction
	OCPNdeleteRoute(what.GUID);
	}

function updatePrediction(what){	// update free-standing prediction with real-time position
	announcer.alert("Will update prediction", 10);
	var route = new Route();
	route.getWithCb(what.GUID);
	var points = route.waypoints;
	var index = getPointBefore(points, what);
	var startWp = points[index];
	// find end of forecast
	var nextIndex = index;
	while (unStashCb(points[nextIndex].description)) {nextIndex++;}
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
	
	var forecast = generatePrediction(hereWp, endWp, stw, stepTime, doCurrents=true);
	forecast.unshift(hereWp);	// revised track to pass through where we are
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

function insertPredicted(what){
	var predicted = new Route();
	predicted.getWithCb(what.GUID);
	if (trace) print("Entered insert predictedroute GUID ", what.GUID, "\n");
	//print(predicted, "\n");
	var pcb = predicted.cb;
	if (pcb.state != "ICC") throw("insertPredicted call wrong");
	var route = new Route();
	route.getWithCb(pcb.routeGUID);
	var waypoints = route.waypoints;	
	// remove any existing insert
	start = findPointInWaypoints(waypoints, pcb.fromGUID) + 1; // the start of possible existing points as offset
	
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
	reportETA(waypoints, route.plannedSpeed, route.plannedDeparture, 0);
/*
	for (var p = 0; p < waypoints.length-1; p++){  // NB omits last
		var stw = waypoints[p].plannedSpeed;	// speed through water
		if (stw == 0) stw = route.plannedSpeed;
		if (!unStashCb(waypoints[p].description)){ // not a prediction
			var distance = OCPNgetVectorPP(waypoints[p].position, waypoints[p+1].position).distance;
			var speed = waypoints[p].plannedSpeed;
			eta += distance/speed*60*60;
			}
		else {	// this is predicted leg
			eta += stepTime*60*60;
			}
		}
	announcer.alert("ETA " + new Date(eta * 1000), 1000000);
*/
	}

function reportETA(waypoints, plannedSpeed, startTime, fromIndex){
	// planned speed - route plabnned speed as default
	// startTime - time from which we start
	// index from which to calculate
	var eta = startTime;
	for (var p = 0; p < waypoints.length-1; p++){  // NB this omits last
		var stw = waypoints[p].plannedSpeed;	// speed through water
		if (stw == 0) stw = plannedSpeed;
		if (!unStashCb(waypoints[p].description)){ // not a prediction
			var distance = OCPNgetVectorPP(waypoints[p].position, waypoints[p+1].position).distance;
			var speed = waypoints[p].plannedSpeed;
			eta += distance/speed*60*60;
			}
		else {	// this is predicted leg
			eta += stepTime*60*60;
			}
		}
	announcer.alert("ETA " + new Date(eta * 1000), 1000000);
	}


announcer = {
	// announcer object handles alerts with time limit to display each message
	// use: announcer.alert("the message", timeout)
	index: 0,
	messages:{},	// structure of messages being displayed
	alert(message,forTime){
		var id = this.index++;	// unique index
		this.messages[id] =  message;	//add message	
		alert(message);
		onSeconds(this.cancel, forTime, id);
		return id;
		},
	cancel(which){
		if (announcer.messages[which] != undefined){
			delete announcer.messages[which];	// delete expired message
			}
		if (alert()){	// only if alert not dismissed
			alert(false); // replace with udated list of alerts
			for (var i in announcer.messages) alert(announcer.messages[i]);
			}
		}
	};

function getPointBefore(waypoints, position){
	// Return index of waypoint before the closest segment	
	var maxDistance = Number.MAX_VALUE;
	var pBefore;	
	for (var p = 0; p < waypoints.length - 1; p++){
		var a = waypoints[p].position;
		var b = waypoints[p+1].position;
		var cosLat = Math.cos(a.latitude * Math.PI/180);
		
		// Northing and easting of b from a
		var nb = 60 * (b.latitude - a.latitude);
		var eb = 60 * (b.longitude - a.longitude) * cosLat;
		
		// Northing and easting of position from a
		var nw = 60 * (position.latitude - a.latitude);
		var ew = 60 * (position.longitude - a.longitude) * cosLat;
		
		// Project position onto segment ab
		var t = (eb*ew + nb*nw) / (eb*eb + nb*nb);
		
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

function noAction(){;}

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
	// this is provided in a functanion so we c place it well down the script out of first sight
	Route.prototype.cb = false;
	
	Route.prototype.getWithCb = function(GUID){ // get route and unstash any cb
		var basicRoute = this.get(GUID);
		if (!basicRoute) throw("getWithCb called on non-existant route");
		this.cb = unStashCb(this.description);
		return true;
		}
	
	Route.prototype.updateWithCb = function(){ // update including cb
		this.description = stashCb(this.description, this.cb);
		return this.update();
		}
	
	Route.prototype.addWithCb = function(){ // add route with cb;
		this.description = stashCb(this.description, this.cb);	
		return this.add(this.GUID);
		}
	
	return Route;
	}

// end of declaratios

OCPNonAllMouseEvent(mouseEvent, RIGHT_DOWN, true);	// off we go
