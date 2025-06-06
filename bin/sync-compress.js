#!/usr/bin/env node

const path = require('path');

const cliPath = path.join(path.dirname(__dirname), 'dist/src/sync-compress.js');

require(cliPath);
