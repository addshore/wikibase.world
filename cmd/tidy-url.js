#!/usr/bin/env node

import process from 'node:process';
import { ContextProvider } from '../src/contextProvider.js'; // Adjusted path
import { world } from '../src/world.js'; // Added
import { queues } from '../src/general.js'; // Added
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

// Helper function to get __dirname in ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the URL from command line arguments
const args = process.argv.slice(2);
const url = args[0];

if (!url) {
  console.error('Please provide a Wikibase URL as the first argument.');
  process.exit(1);
}

console.log(`Tidying Wikibase at URL: ${url}`);

async function main() {
  // 1. Initialize Context Provider
  console.log('Initializing context provider...');
  // Simple initialization for now. Options can be added for caching strategies etc.
  const contextProvider = new ContextProvider(); 

  // 2. Get context for the URL
  console.log(`Gathering context for ${url}...`);
  const context = await contextProvider.getContext(url);
  
  if (!context || context.error) {
    console.error(`Could not gather context for ${url}. Error: ${context ? context.error : 'Unknown error'}. Exiting.`);
    return;
  }
  // console.log('Context gathered:', context); // This can be very verbose
  console.log('Context gathered successfully.');

  // 3. Load Tidy Operations
  console.log('Loading tidy operations...');
  const tidyOperations = await loadTidyOperations();
  if (tidyOperations.length === 0) {
    console.warn('No tidy operations loaded. Exiting.');
    return;
  }
  console.log(`Loaded ${tidyOperations.length} tidy operations.`);

  // 4. Execute Tidy Operations
  console.log('Executing tidy operations...');
  let allProposedChanges = [];
  for (const operation of tidyOperations) {
    console.log(`Running operation: ${operation.name}`);
    try {
      // Ensure context is passed to the run function
      const changes = await operation.run(context); 
      if (changes && Array.isArray(changes) && changes.length > 0) {
        allProposedChanges = allProposedChanges.concat(changes);
        console.log(`Operation ${operation.name} proposed ${changes.length} changes.`);
      } else {
        console.log(`Operation ${operation.name} proposed no changes.`);
      }
    } catch (error) {
      console.error(`Error during operation ${operation.name}:`, error);
    }
  }
  console.log(`Total proposed changes: ${allProposedChanges.length}`);

  // 5. Apply Changes
  if (allProposedChanges.length > 0) {
    console.log('Applying proposed changes...');
    await applyChanges(allProposedChanges, context);
  } else {
    console.log('No changes were proposed by any tidy operation.');
  }

  console.log(`Finished tidying process for ${url}.`);
}

async function applyChanges(proposedChanges, context) {
  if (!proposedChanges || proposedChanges.length === 0) {
    console.log('No changes to apply.');
    return;
  }

  console.log(`Starting to apply ${proposedChanges.length} proposed changes...`);

  for (const change of proposedChanges) {
    const { action, entityId, property, value, oldValue, summary, language } = change; // Added language
    const requestConfig = { summary: summary || 'Tidy script operation' }; // Default summary

    // Ensure entityId is present for all relevant actions
    if (!entityId && (action.includes('Claim') || action.includes('Label') || action.includes('Description') || action.includes('Alias'))) {
        console.warn(`Skipping change due to missing entityId: ${JSON.stringify(change)}`);
        continue;
    }
    // Ensure language is present for term-related actions
    if (!language && (action.includes('Label') || action.includes('Description') || action.includes('Alias'))) {
        console.warn(`Skipping change due to missing language for term operation: ${JSON.stringify(change)}`);
        continue;
    }


    switch (action) {
      case 'createClaim':
        console.log(`Queueing: CREATE claim on ${entityId}, P:${property}, V:${value}. Summary: ${requestConfig.summary}`);
        // Using claimEnsure is often safer to prevent duplicates if the source data hasn't been re-fetched.
        // claimEnsure itself needs to be robust. The current one in world.js fetches the entity.
        // If an operation module already determined the claim doesn't exist, claimCreate could be used.
        // Let's assume 'claimEnsure' is preferred for now.
        // The existing claimEnsure expects { id, property, value }
        world.queueWork.claimEnsure(queues.one, { id: entityId, property, value, qualifiers: change.qualifiers, references: change.references }, requestConfig);
        break;

      case 'updateClaim':
        // The existing world.queueWork.claimUpdate expects { id, property, oldValue, newValue, qualifiers, references }
        // Ensure `oldValue` is part of the change object if using this action.
        if (oldValue === undefined) {
            console.warn(`Skipping updateClaim for P:${property} on ${entityId} due to missing 'oldValue'. Change: ${JSON.stringify(change)}`);
            continue;
        }
        console.log(`Queueing: UPDATE claim on ${entityId}, P:${property}, OldV:${oldValue}, NewV:${value}. Summary: ${requestConfig.summary}`);
        world.queueWork.claimUpdate(queues.one, { id: entityId, property, oldValue, newValue: value, qualifiers: change.qualifiers, references: change.references }, requestConfig);
        break;
      
      // TODO: Implement 'removeClaim' if needed by future operations
      // case 'removeClaim':
      //   console.log(`Queueing: REMOVE claim on ${entityId}, P:${property}, V:${value}. Summary: ${requestConfig.summary}`);
      //   world.queueWork.claimRemove(queues.one, { id: entityId, property, value }, requestConfig);
      //   break;

      case 'setLabel':
        console.log(`Queueing: SET label on ${entityId} for lang ${language} to "${value}". Summary: ${requestConfig.summary}`);
        world.queueWork.labelSet(queues.one, { id: entityId, language: language, value: value }, requestConfig);
        break;

      case 'setDescription':
        console.log(`Queueing: SET description on ${entityId} for lang ${language} to "${value}". Summary: ${requestConfig.summary}`);
        world.queueWork.descriptionSet(queues.one, { id: entityId, language: language, value: value }, requestConfig);
        break;

      case 'addAlias':
        console.log(`Queueing: ADD alias on ${entityId} for lang ${language} as "${value}". Summary: ${requestConfig.summary}`);
        world.queueWork.aliasAdd(queues.one, { id: entityId, language: language, value: value }, requestConfig);
        break;

      case 'removeAlias':
        console.log(`Queueing: REMOVE alias on ${entityId} for lang ${language} value "${value}". Summary: ${requestConfig.summary}`);
        world.queueWork.aliasRemove(queues.one, { id: entityId, language: language, value: value }, requestConfig);
        break;

      default:
        console.warn(`Unknown action type: '${action}' for change: ${JSON.stringify(change)}. Skipping.`);
        break;
    }
  }

  // Wait for all queued tasks in queues.one to complete
  // PQueue's onIdle() returns a promise that resolves when the queue is empty and all promises have settled.
  console.log('All changes have been queued. Waiting for completion...');
  await queues.one.onIdle();
  console.log('All queued changes have been processed.');
  // Also wait for other queues if they are used by operations directly or by world.queueWork internally for sub-steps.
  // For now, assuming primary changes go through queues.one.
  // If world.queueWork functions use other queues internally and don't await them, this might need adjustment.
  // The current world.queueWork functions are async and add to the queue but don't await the queue item itself.
  // This means onIdle() here is for the submission to the queue, not necessarily the completion of the API request.
  // This is a known complexity from the original script. For true "all done", PQueue would need to wrap actual async work.
  // The `retryIn60If429` in world.js handles the actual async work.
  // The queues in general.js are PQueue instances. Adding an async function to them means PQueue manages its execution.
  // So, `queues.one.onIdle()` *should* wait for the actual edits to complete or fail.
}

async function loadTidyOperations() {
  const operations = [];
  // Corrected path to be relative to this script's location (cmd/)
  // then go up to project root, then to src/tidy-operations
  const operationsDir = path.join(__dirname, '..', 'src', 'tidy-operations');

  try {
    const files = await fs.readdir(operationsDir);
    for (const file of files) {
      if (file.endsWith('.js')) {
        const filePath = path.join(operationsDir, file);
        const moduleURL = pathToFileURL(filePath).href;
        try {
          const operationModule = await import(moduleURL);
          
          let mainFunction = null;
          let opName = path.basename(file, '.js'); // Default name to filename without extension

          // Strategy to find the main exported function:
          // 1. Check for a function named like the first operation module: `proposeMediawikiVersionChanges`
          // 2. Check for a common conventional name like `proposeChanges` or `executeOperation`
          // 3. Check for `default` export
          // 4. Fallback to the first function export found
          
          if (typeof operationModule.proposeMediawikiVersionChanges === 'function') {
            mainFunction = operationModule.proposeMediawikiVersionChanges;
            opName = operationModule.proposeMediawikiVersionChanges.operationName || opName;
          } else if (typeof operationModule.proposeChanges === 'function') { // Convention
            mainFunction = operationModule.proposeChanges;
            opName = operationModule.proposeChanges.operationName || opName;
          } else if (typeof operationModule.executeOperation === 'function') { // Another convention
            mainFunction = operationModule.executeOperation;
            opName = operationModule.executeOperation.operationName || opName;
          } else if (typeof operationModule.default === 'function') {
             mainFunction = operationModule.default;
             opName = operationModule.default.operationName || opName;
          } else {
            for (const exportName in operationModule) {
              if (typeof operationModule[exportName] === 'function') {
                mainFunction = operationModule[exportName];
                opName = operationModule[exportName].operationName || exportName;
                break; 
              }
            }
          }
          
          if (mainFunction) {
            operations.push({ run: mainFunction, name: opName });
            console.log(`Loaded tidy operation: ${opName} from ${file}`);
          } else {
            console.warn(`Could not find a suitable exported function in ${file}.`);
          }
        } catch (e) {
          console.error(`Error importing operation module ${file}:`, e);
        }
      }
    }
  } catch (e) {
    console.error(`Error reading tidy operations directory ${operationsDir}:`, e);
    // If the directory itself can't be read, it might be a setup issue.
    // Depending on strictness, could re-throw or exit. For now, just log.
  }
  return operations;
}

main().catch(error => {
  console.error('An unexpected error occurred in main:', error);
  process.exit(1);
});
