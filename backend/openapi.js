"use strict";

const path = require("path");
const OpenApiValidator = require("express-openapi-validator");

const specificationPath = path.join(__dirname, "..", "openapi", "openapi.json");

function installOpenApi(app) {
  app.get("/api/openapi.json", (_request, response) => {
    response.sendFile(specificationPath);
  });
  app.use(
    OpenApiValidator.middleware({
      apiSpec: specificationPath,
      ignoreUndocumented: true,
      validateRequests: true,
      validateResponses: false,
    }),
  );
}

module.exports = { installOpenApi, specificationPath };
