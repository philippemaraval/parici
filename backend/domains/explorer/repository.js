"use strict";

const database = require("../../database");

function query(text, parameters) {
  return database.pool.query(text, parameters);
}

module.exports = { query, connect: () => database.pool.connect() };
