# Use the official Node.js image with Alpine Linux as the base image
FROM node:alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Set a default value for MATCH_SIZE
ENV MATCH_SIZE=2

# Expose the port on which your Node.js app will run
EXPOSE 7654/udp

# Command to run your Node.js application
CMD ["node", "./src/index.js"]
