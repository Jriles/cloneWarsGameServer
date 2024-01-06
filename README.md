# Clone Wars Game Server

This is the server for a game you can find here: https://alexanderriley.itch.io/clone-wars-game 

## Instructions

### clone the repo
> git clone git@github.com:Jriles/cloneWarsGameServer.git

### build docker image
> docker build -t server .

### run the container
> docker run -p 7654:7654 -p 7654:7654/udp -e MATCH_SIZE=1 server
Where match size is the desired match size. There is no limit currently, but I haven't tested the server with more than three clients.

