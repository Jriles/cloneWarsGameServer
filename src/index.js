// const AgonesSDK = require('@google-cloud/agones-sdk');
const util = require('util');
// const axios = require('axios')
var StateMachine = require('javascript-state-machine');
var udp = require('dgram');

// creating a udp server
var server = udp.createSocket('udp4');

//*************//
//	constants	 //
//*************//
const DROIDS = "droids";
const CLONES = "clones";

const gameModes = [
	"TDM",
	"CTF"
];
const DEFAULT_HEALTH_TOTAL = 100;
const TDM_WINNING_KILL_COUNT = 10;
const MATCH_SIZE = 2

//player's id is their index
var players = [];
//position 0 = pirate score
//position 1 = merchant score
var score = {
	"droids": 0,
	"clones": 0
};
//this could be TDM, CTF or other gamemodes we add down the line.
var gameMode = "TDM";
// let agonesSDK = new AgonesSDK();

//******************/
// GAME STATE HERE //
//******************/
let gameActive = true;

//***********//
//	router	 //
//***********//
// emits on new datagram msg
server.on('message', function (msg, info)
{
	const msgStr = msg.toString();
	//*******************//
	// Messages have the following structure:
	// - opCode: an integer that tells the switch what sort of action event has occured
	// - content: a string used to capture any other relevant data
	//*******************//
	try {
		const msgJSON = JSON.parse(msgStr);

		// were going to want an OP code for what type of action a player is taking
		// then were also goign to want a player id so we know who to apply the change to on each screen
		// sometimes we wont need the player code, we'll ignore that information if thats the case
		switch (Number(msgJSON.opCode)) {
			case 0:
				//Connect to server case
				//which in this case will save the team (droids or clones) in the players array.

				//0 = PIRATES
				//1 = MERCHANTS
				var team;
				if (players.length % 2 == 0)
				{
					team = DROIDS;
				}
				else
				{
					team = CLONES;
				}
				const newPlayerIdx = players.length;
				var newPlayer = new PlayerStateMachine(
					newPlayerIdx,
					team,
					info.address,
					info.port,
					//starting health
					DEFAULT_HEALTH_TOTAL,
					msgJSON.content.weapon,
					msgJSON.content.gamerTag,
					//left or right, same as team (for now, but its related to team regardless, at least to start)
					team,
					//we receive this from the frontend, not sure theres an alternative to this
					msgJSON.content.playerApiId,
					msgJSON.content.sessionToken
				);
				players.push(newPlayer);
                const newPlayerMsg = getResponseObj(0, newPlayerIdx, newPlayer.team);
				server.send(JSON.stringify(newPlayerMsg), info.port, info.address, sendMessageCallback);
                console.log(newPlayer)
                console.log("player connected")
				if (players.length == MATCH_SIZE)
				{
					newPlayerMsg["opCode"] = 5;
					newPlayerMsg["content"] = getPlayersData();
					sendToAll(newPlayerMsg);
				}
				break;
			case 1:
				// jump case
				// message clients
				const player = players[msgJSON.playerIdx];
				if (player.is("jumping")
						//handling double jump criteria here
						&& player.jumpCount <= 1)
				{
					//we are jumping again
					player.increaseJumpCountByOne();
					//if we already walking right just keep doing that
					const responseObj = getResponseObj(1, msgJSON.playerIdx, "");
					sendToAll(responseObj);
				} else {
					transitionPlayerToJumping(msgJSON.playerIdx);
				}
				break;
			case 2:
				//walk case
				const walkingMsg = getResponseObj(2, msgJSON.playerIdx, msgJSON.content);
                sendToAll(walkingMsg);
                transitionPlayerToWalking(msgJSON.playerIdx);

				break;
			case 4:
                const rotationMsg = getResponseObj(4, msgJSON.playerIdx, msgJSON.content);
				sendToAll(rotationMsg);
				transitionPlayerToAttacking(msgJSON.playerIdx);
				break;
			case 5:
                const responseObj = getResponseObj(6, msgJSON.playerIdx, msgJSON.content);
				sendToAll(responseObj);
				transitionPlayerToAttacking(msgJSON.playerIdx);
				break;
			case 6:
				//someone took damage
				var dmgResponseObj = {}
                dmgResponseObj["opCode"] = 7;
				dmgResponseObj["playerIdx"] = msgJSON.playerIdx;
				const damageAmount = msgJSON.content;
				const currentHealthAmount = players[msgJSON.playerIdx].health;
                const newHealth = currentHealthAmount - damageAmount
				players[msgJSON.playerIdx].health = newHealth
				dmgResponseObj["content"] = newHealth / DEFAULT_HEALTH_TOTAL;
				sendToAll(dmgResponseObj);

				checkAndKillPlayer(dmgResponseObj, msgJSON);

				TDMGameOverHandler(dmgResponseObj);
				break;
			case 7:
				// thinks someone needs to be respawned
				//first we'll reset their health.
				players[msgJSON.playerIdx].health = DEFAULT_HEALTH_TOTAL;
				//then we'll respawn the player on the connected clients
				responseObj["opCode"] = 9;
				responseObj["playerIdx"] = msgJSON.playerIdx;
				responseObj["content"] = players[msgJSON.playerIdx];
				sendToAll(responseObj);
				break;
			case 8:
				//someone became idle
                const idleMsg = getResponseObj(12, msgJSON.playerIdx, msgJSON.content);
                sendToAll(idleMsg);
                transitionPlayerToIdle(msgJSON.playerIdx);
				break;
            case 9:
				// position/rotation update
                const newPosMsg = getResponseObj(13, msgJSON.playerIdx, msgJSON.content);
                sendToAll(newPosMsg);
            case 10:
                const stopAttackingMsg = getResponseObj(14, msgJSON.playerIdx, "");
                sendToAll(stopAttackingMsg);
		}
	}
	catch (error)
	{
		console.log(error);
	}
});

//***********************//
//	state machine stuff	 //
//***********************//
const PlayerStateMachine = new StateMachine.factory({
	init: 'idle',
	transitions: [
		{ name: 'enableInput', from: 'disabled', to: 'idle'},
		//to walking 
		{ name: 'idleToWalking', from: 'idle', to: 'walking'},
		{ name: 'aimingToWalking', from: 'aiming', to: 'walking'},
		{ name: 'attackingToWalking', from: 'attacking', to: 'walking'},
		{ name: 'jumpingToWalking', from: 'jumping', to: 'walking'},
		// to aiming
		{ name: 'idleToAiming', from: 'idle', to: 'aiming'},
		{ name: 'walkingToAiming', from: 'walking', to: 'aiming'},
		{ name: 'attackingToAiming', from: 'attacking', to: 'aiming'},
		{ name: 'jumpingToAiming', from: 'jumping', to: 'aiming'},

		// to jumping
		{ name: 'aimingToJumping', from: 'aiming', to: 'jumping'},
		{ name: 'attackingToJumping', from: 'attacking', to: 'jumping'},
		{ name: 'idleToJumping', from: 'idle', to: 'jumping'},
		{ name: 'walkingToJumping', from: 'walking', to: 'jumping'},

		// to attacking
		{ name: 'idleToAttacking', from: 'idle', to: 'attacking'},
		{ name: 'walkingToAttacking', from: 'walking', to: 'attacking'},
		{ name: 'aimingToAttacking', from: 'aiming', to: 'attacking'},
		{ name: 'jumpingToAttacking', from: 'jumping', to: 'attacking'},

		// to idle
		{ name: 'walkingToIdle', from: 'walking', to: 'idle'},
		{ name: 'aimingToIdle', from: 'aiming', to: 'idle'},
		{ name: 'jumpingToIdle', from: 'jumping', to: 'idle'},
		{ name: 'attackingToIdle', from: 'attacking', to: 'idle'},
		//respawn case here
		{ name: 'deadToIdle', from: 'dead', to: 'idle'},

		//to dead
		{ name: 'walkingToDead', from: 'walking', to: 'dead'},
		{ name: 'aimingToDead', from: 'aiming', to: 'dead'},
		{ name: 'jumpingToDead', from: 'jumping', to: 'dead'},
		{ name: 'attackingToDead', from: 'attacking', to: 'dead'},
		{ name: 'idleToDead', from: 'idle', to: 'dead'}
	],
	data: function(playerIdx, team, networkAddress, port,
		 						 health, weapon, gamerTag, playerDir, playerApiId, sessionToken) {
		return {
			playerIdx: playerIdx,
			team: team,
			networkAddress: networkAddress,
			port: port,
			health: health,
			//this should contain what weapon they are using for this match
			weapon: weapon,
			gamerTag: gamerTag,
			//player direction
			//0 for left, 1 for right
			//we want them to face right if they are clones, left if droids
			//droids go on the right side, clones on the left
			playerDir: playerDir,
			playerApiId: playerApiId,
			sessionToken: sessionToken,
			aimDir: "",
			hitDir: "",
			//used for double jump
			jumpCount: 0
		}
	},
	methods: {
		//setters//
		setAimDir: function (dir)
		{
			this.aimDir = dir;
		},
		//sets the direction from which this player has been attacked
		setHitDir: function (dir)
		{
			this.hitDir = dir;
		},
		resetHealth: function ()
		{
			this.health = DEFAULT_HEALTH_TOTAL;
		},
		increaseJumpCountByOne: function ()
		{
			this.jumpCount++;
		},
		resetJumpCount: function ()
		{
			this.jumpCount = 0;
		},
		//observers//
		//on walk left
		onIdleToWalking: function ()
		{
			const responseObj = getResponseObj(3, this.playerIdx, "");
			sendToAll(responseObj);
		},
		onAimingToWalking: function ()
		{
			const responseObj = getResponseObj(3, this.playerIdx, "");
			sendToAll(responseObj);
		},
		onAttackingToWalking: function ()
		{
			const responseObj = getResponseObj(3, this.playerIdx, "");
			sendToAll(responseObj);
		},
		onJumpingToWalking: function ()
		{
			const responseObj = getResponseObj(3, this.playerIdx, "");
			sendToAll(responseObj);
		},
		//on aim
		onIdleToAiming: function ()
		{
			const responseObj = getResponseObj(4, this.playerIdx, this.aimDir);
			sendToAll(responseObj);
		},
		onWalkingToAiming: function ()
		{
			const responseObj = getResponseObj(4, this.playerIdx, this.aimDir);
			sendToAll(responseObj);
		},
		onAttackingToAiming: function ()
		{
			const responseObj = getResponseObj(4, this.playerIdx, this.aimDir);
			sendToAll(responseObj);
		},
		onJumpingToAiming: function ()
		{
			const responseObj = getResponseObj(4, this.playerIdx, this.aimDir);
			sendToAll(responseObj);
		},
		//on jump
		onAimingToJumping: function ()
		{
			//for double jumping
			this.increaseJumpCountByOne();
			const responseObj = getResponseObj(1, this.playerIdx, "");
			sendToAll(responseObj);
		},
		onAttackingToJumping: function ()
		{
			this.increaseJumpCountByOne();
			const responseObj = getResponseObj(1, this.playerIdx, "");
			sendToAll(responseObj);
		},
		onIdleToJumping: function ()
		{
			this.increaseJumpCountByOne();
			const responseObj = getResponseObj(1, this.playerIdx, "");
			sendToAll(responseObj);
		},
		onWalkingToJumping: function ()
		{
		  this.increaseJumpCountByOne();
			const responseObj = getResponseObj(1, this.playerIdx, "");
			sendToAll(responseObj);
		},
		//on attack
		onIdleToAttacking: function ()
		{
			const responseObj = getResponseObj(6, this.playerIdx, this.aimDir);
			sendToAll(responseObj);
		},
		onWalkingToAttacking: function ()
		{
			const responseObj = getResponseObj(6, this.playerIdx, this.aimDir);
			sendToAll(responseObj);
		},
		onAimingToAttacking: function ()
		{
			const responseObj = getResponseObj(6, this.playerIdx, this.aimDir);
			sendToAll(responseObj);
		},
		onJumpingToAttacking: function ()
		{
			const responseObj = getResponseObj(6, this.playerIdx, this.aimDir);
			sendToAll(responseObj);
		},
		//on idle
		//TODO
		onWalkingToIdle: function ()
		{

		},
		onAimingToIdle: function ()
		{

		},
		onJumpingToIdle: function ()
		{
			this.resetJumpCount();
		},
		onAttackingToIdle: function ()
		{

		},
		onDeadToIdle: function ()
		{
			this.resetHealth();
			respawnPlayerOnClients(this.playerIdx);
		},
		//died
		//Can only die via killing, at this time.
		onWalkingToDead: function ()
		{
			//need these for async transitions
			playerDiedHandler(this.playerIdx, this.hitDir);
		},
		onAimingToDead: function ()
		{
			playerDiedHandler(this.playerIdx, this.hitDir);
		},
		onJumpingToDead: function ()
		{
			playerDiedHandler(this.playerIdx, this.hitDir);
		},
		onAttackingToDead: function ()
		{
			playerDiedHandler(this.playerIdx, this.hitDir);
		},
		onIdleToDead: function ()
		{
			playerDiedHandler(this.playerIdx, this.hitDir);
		}
	}
});

function transitionPlayerToDead (playerIdx)
{
	const player = players[playerIdx];
	switch (player.state)
	{
		case "jumping":
			player.jumpingToDead();
			break;
		case "idle":
			player.idleToDead();
			break;
		case "walking":
			player.walkingToDead();
			break;
		case "attacking":
			player.attackingToDead();
			break;
		case "aiming":
			player.aimingToDead();
			break;
		//else do nothing
	}
}

function transitionPlayerToIdle (playerIdx)
{
	const player = players[playerIdx];
	switch (player.state)
	{
		case "aiming":
			player.aimingToIdle();
			break;
		case "dead":
			player.deadToIdle();
			break;
		case "walking":
			player.walkingToIdle();
			break;
		case "attacking":
			player.attackingToIdle();
			break;
		case "jumping":
			player.jumpingToIdle();
			break;
		//else do nothing
	}
}

function transitionPlayerToJumping (playerIdx)
{
	// update state machine
	const player = players[playerIdx];
	switch (player.state)
	{
		case "aiming":
			player.aimingToJumping();
			break;
		case "idle":
			player.idleToJumping();
			break;
		case "walking":
			player.walkingToJumping();
			break;
		case "attacking":
			player.attackingToJumping();
			break;
		//else do nothing
	}
}

function transitionPlayerToWalkingRight (playerIdx)
{
	const player = players[playerIdx];
	switch (player.state)
	{
		case "idle":
			player.idleToWalkRight();
			break;
		case "aiming":
			player.aimingToWalkRight();
			break;
		case "attacking":
			player.attackingToWalkRight();
			break;
		case "walking":
			player.walkingToWalkingRight();
			break;
		case "jumping":
			player.jumpingToWalkingRight();
			break;
	}
}

function transitionPlayerToWalking (playerIdx)
{
	const player = players[playerIdx];
	switch (player.state)
	{
		case "idle":
			player.idleToWalking();
			break;
		case "aiming":
			player.aimingToWalkLeft();
			break;
		case "attacking":
			player.attackingToWalking();
			break;
		case "jumping":
			player.jumpingToWalking();
			break;
	}
}

function transitionPlayerToAiming (playerIdx)
{
	const player = players[playerIdx];
	switch (player.state)
	{
		case "jumping":
			player.jumpingToAiming();
			break;
		case "idle":
			player.idleToAiming();
			break;
		case "walking":
			player.WalkingToAiming();
			break;
		case "attacking":
			player.attackingToAiming();
			break;
		//else do nothing
	}
}

function transitionPlayerToAttacking (playerIdx)
{
	const player = players[playerIdx];
	switch (player.state)
	{
		case "jumping":
			player.jumpingToAttacking();
			break;
		case "idle":
			player.idleToAttacking();
			break;
		case "walking":
			player.walkingToAttacking();
			break;
		case "aiming":
			player.aimingToAttacking();
			break;
		//else do nothing
	}
}

//***********//
//	Helpers  //
//***********//
function sendMessageCallback (error)
{
 if (error)
 {
	 client.close();
 }
}

function sendToAll (responseObj)
{
	responseObj = JSON.stringify(responseObj);
	for (i = 0; i < MATCH_SIZE; i++)
	{
		server.send(responseObj, players[i].port, players[i].networkAddress, sendMessageCallback);
	}
}

function checkAndKillPlayer (responseObj, msgJSON)
{
	//kill player if their health <= 0
	if (players[msgJSON.playerIdx].health <= 0)
	{
		players[msgJSON.playerIdx].setHitDir(
			{
				hitDirX: msgJSON.content.hitDirX,
				hitDirY: msgJSON.content.hitDirY
			});

		//alter player's state to dead
		transitionPlayerToDead(msgJSON.playerIdx);

		//then respawn the player
		//when they transition from dead to idle the clients
		// get notified and we reset the health (on server, not clients)
		transitionPlayerToIdle(msgJSON.playerIdx);

		// player was killed by another player here
		// if the gamemode is TDM we want to add to this player's team score
		// and personal score to some extent
		const team = players[msgJSON.playerIdx].team
        if (team === CLONES) {
            score[DROIDS]++
        } else {
            score[CLONES]++
        }
		
		//update clients with new scores.
		responseObj["opCode"] = 10;
		responseObj["content"] = score;
		sendToAll(responseObj);
	}
}

function tdmGameOver (score)
{
	if (score[DROIDS] >= TDM_WINNING_KILL_COUNT || score[CLONES] >= TDM_WINNING_KILL_COUNT)
	{
		return true;
	}
	return false;
}

async function TDMGameOverHandler (responseObj)
{
	if (gameMode === gameModes[0])
	{
		//only want to go through this once
		if (tdmGameOver(score) && gameActive)
		{
			//game is over, 
			//gameActive = false;
			responseObj["opCode"] = 11;
			let winningTeam;
			let loosingTeam;
			//we want to send a message that the game is over and which team won
			if (score[DROIDS] >= TDM_WINNING_KILL_COUNT)
			{
				//zero as in the droids won
				winningTeam = DROIDS;
				loosingTeam = CLONES;
			}
			else if (score[CLONES] >= TDM_WINNING_KILL_COUNT)
			{
				//1 as in the clones won.
				winningTeam = CLONES;
				loosingTeam = DROIDS;
			}
			
			//update player experience
			//updatePlayersExperience(winningTeam, loosingTeam);

			responseObj["content"] = winningTeam;

            console.log("game over!")
			//notify clients of developments
			sendToAll(responseObj);

            score[DROIDS] = 0
            score[CLONES] = 0
            players = [];

			//this game is over
			//shut it down lads
			try
			{
				//await agonesSDK.shutdown();
			}
			catch (error)
			{
				console.error(error);
			}
		}
	}
}

function getResponseObj (opCode, playerIdx, content)
{
	var responseObj = {};
	responseObj["opCode"] = opCode;
	responseObj["playerIdx"] = playerIdx;
	responseObj["content"] = content;
	return responseObj;
}

function playerDiedHandler (playerIdx, hitDir)
{
	//first we kill the player
	const responseObj = getResponseObj(8, playerIdx, hitDir);
	sendToAll(responseObj);
}

function respawnPlayerOnClients (playerIdx)
{
	const responseObj = getResponseObj(9, playerIdx, getPlayerData(players[playerIdx]));
	sendToAll(responseObj);
	//reset them to idle
	//this implicitly resets the player's health value
}

function getPlayerData (player)
{
	const playerData = {
		team: player.team,
		networkAddress: player.networkAddress,
		port: player.port,
		health: player.health,
		weapon: player.weapon,
		gamerTag: player.gamerTag,
		playerDir: player.playerDir,
		playerApiId: player.playerApiId,
		sessionToken: player.sessionToken
	};
	return playerData
}

function getPlayersData ()
{
	return players.map(getPlayerData);
}

server.on('listening', function ()
{
  var address = server.address();
  var port = address.port;
  // var family = address.family;
  var ipaddr = address.address;
  console.log('Server is listening at port ' + port);
  console.log('Server ip :' + ipaddr);
});

server.bind(7654, '0.0.0.0');