const swaggerJsDoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

const options = {
  definition: {
    openapi: "3.0.0", // Swagger/OpenAPI version
    info: {
      title: "Wallet API",
      version: "1.0.0",
      description: "API documentation for Claim & Stake backend",
    },
    servers: [
      {
        url: "http://localhost:3001", // your backend URL
      },
    ],
  },
  apis: ["./router/*.js", "./server.js"], // files where routes are defined
};

const swaggerSpec = swaggerJsDoc(options);

module.exports = { swaggerUi, swaggerSpec };
