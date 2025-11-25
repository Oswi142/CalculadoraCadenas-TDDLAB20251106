import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { spawn } from 'cross-spawn';
import { v4 as uuid } from 'uuid';

const COMMAND = 'jest';
const args = ['--json', '--outputFile=./script/report.json'];

function runCommand(command, args) {
  return new Promise((resolve) => {
    const process = spawn(command, args, { stdio: 'inherit' });
    process.on('close', () => resolve());
  });
}

function ensureNDJSON(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '');
  }
}

const extractAndAddObject = async (reportFile, tddLogFile) => {
  try {
    await runCommand(COMMAND, args);

    ensureNDJSON(tddLogFile);

    const jsonData = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));

    const newReport = {
      numPassedTests: jsonData.numPassedTests,
      failedTests: jsonData.numFailedTests,
      numTotalTests: jsonData.numTotalTests,
      timestamp: jsonData.startTime,
      success: jsonData.success,
      testId: uuid()
    };

    fs.appendFileSync(tddLogFile, JSON.stringify(newReport) + '\n');

  } catch (error) {
    console.error('Error en la ejecución:', error);
  }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputFilePath = path.join(__dirname, 'report.json');
const outputFilePath = path.join(__dirname, 'tdd_log.ndjson');

extractAndAddObject(inputFilePath, outputFilePath);

export { extractAndAddObject };
