#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

async function askFolderName() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('Enter the project folder name: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  let folderName = process.argv[2];

  if (!folderName) {
    folderName = await askFolderName();
  }

  if (!folderName) {
    console.error('Error: folder name is required.');
    process.exit(1);
  }

  const targetDir = path.resolve(process.cwd(), folderName);

  if (fs.existsSync(targetDir)) {
    console.error(`Error: directory "${folderName}" already exists.`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const templateFile = path.join(__dirname, 'template', 'chadstart.yaml');
  const destFile = path.join(targetDir, 'chadstart.yaml');
  fs.copyFileSync(templateFile, destFile);

  console.log(`\nCreated project in ${targetDir}`);
  console.log('\nNext steps:');
  console.log(`  cd ${folderName}`);
  console.log('  npx chadstart dev\n');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
