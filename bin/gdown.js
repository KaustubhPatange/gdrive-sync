#!/usr/bin/env node

const path = require('path');

const cliPath = path.join(path.dirname(__dirname), 'dist/src/gdown.js');

require(cliPath).main();
