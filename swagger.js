import swaggerJsDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Wallet API",
      version: "1.0.0",
      description: "API documentation for Claim & Stake backend",
    },
    servers: [{ url: "http://localhost:3001" }],
  },
  apis: ["./router/*.js", "./server.js"],
};

const swaggerSpec = swaggerJsDoc(options);

export { swaggerUi, swaggerSpec };
