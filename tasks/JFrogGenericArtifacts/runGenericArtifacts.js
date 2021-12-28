const tl = require('azure-pipelines-task-lib/task');
const utils = require('@jfrog/tasks-utils/utils.js');
const path = require('path');

const cliUploadCommand = 'rt u';
const cliDownloadCommand = 'rt dl';
const cliSetPropertiesCommand = 'rt sp';
const cliDeletePropertiesCommand = 'rt delp';
const cliMoveCommand = 'rt mv';
const cliCopyCommand = 'rt cp';
const cliDeleteArtifactsCommand = 'rt del';
let serverId;

function RunTaskCbk(cliPath) {
    let workDir = tl.getVariable('System.DefaultWorkingDirectory');
    if (!workDir) {
        tl.setResult(tl.TaskResult.Failed, 'Failed getting default working directory.');
        return;
    }

    // The 'connection' input parameter is used by Artifact Source Download and cannot be renamed due to Azure limitations.
    let artifactoryService = tl.getInput('connection', true);
    serverId = utils.assembleUniqueServerId('generic');
    utils.configureArtifactoryCliServer(artifactoryService, serverId, cliPath, workDir);

    // Decide if the task runs as generic or artifact-source download.
    let definition = tl.getInput('definition', false);
    if (definition) {
        console.log('Artifact source download...');
        performArtifactSourceDownload(cliPath, workDir);
        return;
    }

    let genericCommand = tl.getInput('command', true);

    switch (genericCommand) {
        case 'Upload':
            handleGenericUpload(cliPath, workDir);
            break;
        case 'Download':
            handleGenericDownload(cliPath, workDir);
            break;
        case 'Set Properties':
            handleGenericSetProperties(cliPath, workDir);
            break;
        case 'Delete Properties':
            handleGenericDeleteProperties(cliPath, workDir);
            break;
        case 'Move':
            handleGenericMove(cliPath, workDir);
            break;
        case 'Copy':
            handleGenericCopy(cliPath, workDir);
            break;
        case 'Delete':
            handleGenericDeleteArtifacts(cliPath, workDir);
            break;
        default:
            tl.setResult(tl.TaskResult.Failed, 'Command not supported: ' + genericCommand);
    }
}

function handleGenericUpload(cliPath, workDir) {
    let cliCommand = utils.cliJoin(cliPath, cliUploadCommand);
    cliCommand = utils.appendBuildFlagsToCliCommand(cliCommand);
    cliCommand = utils.addBoolParam(cliCommand, 'dryRun', 'dry-run');

    cliCommand = utils.addBoolParam(cliCommand, 'preserveSymlinks', 'symlinks');
    cliCommand = addDebParam(cliCommand);

    let syncDeletes = tl.getBoolInput('syncDeletesRemote');
    if (syncDeletes) {
        cliCommand = utils.addStringParam(cliCommand, 'syncDeletesPathRemote', 'sync-deletes', false);
    }
    performGenericTask(cliCommand, cliPath, workDir);
}

function handleGenericDownload(cliPath, workDir) {
    let cliCommand = utils.cliJoin(cliPath, cliDownloadCommand);
    cliCommand = utils.appendBuildFlagsToCliCommand(cliCommand);
    cliCommand = utils.addBoolParam(cliCommand, 'dryRun', 'dry-run');

    cliCommand = utils.addIntParam(cliCommand, 'splitCount', 'split-count');
    cliCommand = utils.addIntParam(cliCommand, 'minSplit', 'min-split');

    cliCommand = utils.addBoolParam(cliCommand, 'validateSymlinks', 'validate-symlinks');

    let syncDeletes = tl.getBoolInput('syncDeletesLocal');
    if (syncDeletes) {
        cliCommand = utils.addStringParam(cliCommand, 'syncDeletesPathLocal', 'sync-deletes', false);
    }
    performGenericTask(cliCommand, cliPath, workDir);
}

function handleGenericSetProperties(cliPath, workDir) {
    let props = tl.getInput('setProps', false);
    let cliCommand = utils.cliJoin(cliPath, cliSetPropertiesCommand, utils.quote(props));
    performGenericTask(cliCommand, cliPath, workDir);
}

function handleGenericDeleteProperties(cliPath, workDir) {
    let props = tl.getInput('deleteProps', false);
    let cliCommand = utils.cliJoin(cliPath, cliDeletePropertiesCommand, utils.quote(props));
    performGenericTask(cliCommand, cliPath, workDir);
}

function handleGenericMove(cliPath, workDir) {
    let cliCommand = utils.cliJoin(cliPath, cliMoveCommand);
    cliCommand = utils.addBoolParam(cliCommand, 'dryRun', 'dry-run');
    performGenericTask(cliCommand, cliPath, workDir);
}

function handleGenericCopy(cliPath, workDir) {
    let cliCommand = utils.cliJoin(cliPath, cliCopyCommand);
    cliCommand = utils.addBoolParam(cliCommand, 'dryRun', 'dry-run');
    performGenericTask(cliCommand, cliPath, workDir);
}

function handleGenericDeleteArtifacts(cliPath, workDir) {
    let cliCommand = utils.cliJoin(cliPath, cliDeleteArtifactsCommand);
    cliCommand = utils.addBoolParam(cliCommand, 'dryRun', 'dry-run');
    performGenericTask(cliCommand, cliPath, workDir);
}

function performGenericTask(cliCommand, cliPath, workDir) {
    let specPath = path.join(workDir, 'genericSpec' + Date.now() + '.json');
    cliCommand = utils.addServerIdOption(cliCommand, serverId);
    try {
        cliCommand = utils.addCommonGenericParams(cliCommand, specPath);
        // Execute the cli command.
        utils.executeCliCommand(cliCommand, workDir, null);
    } catch (executionException) {
        tl.setResult(tl.TaskResult.Failed, executionException);
    } finally {
        utils.deleteCliServers(cliPath, workDir, [serverId]);
        // Remove created fileSpec from file system.
        try {
            tl.rmRF(specPath);
        } catch (fileException) {
            tl.setResult(tl.TaskResult.Failed, 'Failed cleaning temporary FileSpec file: ' + specPath);
        }
    }

    // Ignored if previously failed.
    tl.setResult(tl.TaskResult.Succeeded, 'Download Succeeded.');
}

function addDebParam(cliCommand) {
    let setDebianProps = tl.getBoolInput('setDebianProps');
    if (setDebianProps) {
        let distribution = tl.getInput('debDistribution', true).replace(/\//g, '\\/');
        let component = tl.getInput('debComponent', true).replace(/\//g, '\\/');
        let architecture = tl.getInput('debArchitecture', true).replace(/\//g, '\\/');
        let debValue = [distribution, component, architecture];
        cliCommand = utils.cliJoin(cliCommand, '--deb=' + utils.quote(debValue.join('/')));
    }
    return cliCommand;
}

function performArtifactSourceDownload(cliPath, workDir) {
    // 'ARTIFACTORY_RELEASE_BUILD_NUMBER' is used to support providing 'LATEST' version by the user.
    // When Azure DevOps Server supports Artifactory's LATEST version natively, this variable could be removed.
    let buildNumber = tl.getVariable('ARTIFACTORY_RELEASE_BUILD_NUMBER') || tl.getInput('version', true);
    let buildName = tl.getInput('definition', true);
    // 'downloadPath' is provided by server when artifact-source is used.
    let downloadPath = tl.getInput('downloadPath', true);
    if (!downloadPath.endsWith('/') && !downloadPath.endsWith('\\')) {
        downloadPath += '/';
    }
    downloadPath = utils.fixWindowsPaths(downloadPath);

    let cliCommand = utils.cliJoin(
        cliPath,
        cliDownloadCommand,
        utils.quote('*'),
        utils.quote(downloadPath),
        '--build=' + utils.quote(buildName + '/' + buildNumber),
        '--flat',
        '--fail-no-op'
    );

    // Add project flag if provided
    cliCommand = utils.addProjectOption(cliCommand);
    cliCommand = utils.addServerIdOption(cliCommand, serverId);

    try {
        utils.executeCliCommand(cliCommand, workDir, null);
        tl.setResult(tl.TaskResult.Succeeded, 'Download Succeeded.');
    } catch (ex) {
        tl.setResult(tl.TaskResult.Failed, ex);
    } finally {
        utils.deleteCliServers(cliPath, workDir, [serverId]);
    }
}

utils.executeCliTask(RunTaskCbk);