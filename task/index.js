"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const tl = require("azure-pipelines-task-lib/task");
const azStorage = require("azure-storage");
const axios = require("axios");
function normalizeText(text) {
    return text.normalize().toLowerCase().replace(/[^a-zA-Z]+/g, '');
}
function removePrefix(version) {
    if (version != null) {
        return version.replace(/[^0-9\.]+/g, '');
    }
    return version;
}
function sendRequest(method, url, data, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    if (callback)
        xhr.onload = function () { callback(JSON.parse(this['responseText'])); };
    if (data != null) {
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(data));
    }
    else
        xhr.send();
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function padLeft(text, padChar, size) {
    return (String(padChar).repeat(size) + text).substr((size * -1), size);
}
function isRollback(oldVersion, newVersion) {
    if (/^\d+.\d+.\d+$/.test(oldVersion) && /^\d+.\d+.\d+$/.test(newVersion)) {
        var oldParts = oldVersion.split(".");
        var newParts = newVersion.split(".");
        var oldMajor = Number(oldParts[0]);
        var oldMinor = Number(oldParts[1]);
        var oldPatch = Number(oldParts[2]);
        var newMajor = Number(newParts[0]);
        var newMinor = Number(newParts[1]);
        var newPatch = Number(newParts[2]);
        if (newMajor > oldMajor)
            return false;
        if (oldMajor > newMajor)
            return true;
        if (newMinor > oldMinor)
            return false;
        if (oldMinor > newMinor)
            return true;
        return oldPatch > newPatch;
    }
    if (/^\d+.\d+$/.test(oldVersion) && /^\d+.\d+$/.test(newVersion)) {
        var oldParts = oldVersion.split(".");
        var newParts = newVersion.split(".");
        var oldMajor = Number(oldParts[0]);
        var oldMinor = Number(oldParts[1]);
        var newMajor = Number(newParts[0]);
        var newMinor = Number(newParts[1]);
        if (newMajor > oldMajor)
            return false;
        if (oldMajor > newMajor)
            return true;
        return oldMinor > newMinor;
    }
    return false;
}
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // declare
            var slackUrl = tl.getInput('slack_url', true);
            var newVersion = tl.getInput('new_version', true);
            var azureConnString = tl.getInput('azure_conn', true);
            var azureContainer = tl.getInput('azure_container', true);
            var isHotfix = tl.getInput('is_hotfix', false);
            var appName = tl.getInput('app_name', true);
            var environment = tl.getInput('environment', true);
            var newUrl = tl.getInput('new_url', true);
            var appNameNormalized = `${normalizeText(appName)}.${normalizeText(environment)}`;
            console.log(`environment: ${environment}`);
            console.log(`appName: ${appName}`);
            console.log(`appNameNormalized: ${appNameNormalized}`);
            console.log(`isHotfix: ${isHotfix}`);
            var slackName = "Azure DevOps";
            var slackIcon = "https://i.imgur.com/YsiCtzd.png";
            var filePath = appNameNormalized + ".txt";
            var newFileContent = newVersion + "\n" + // line 1 - version
                newUrl; // line 2 - details url
            var oldVersion = "<unknow>";
            var oldUrl = newUrl;
            // conn azure storage
            var blob = azStorage.createBlobService(azureConnString);
            yield blob.createContainerIfNotExists(azureContainer, function (error, result, response) {
                return __awaiter(this, void 0, void 0, function* () {
                    if (error) {
                        tl.setResult(tl.TaskResult.Failed, "------------- Error in Azure Storage (CreateContainer)! \n\nError: " + error.message);
                        return;
                    }
                    blob.getBlobToText(azureContainer, filePath, function (error, result, response) {
                        return __awaiter(this, void 0, void 0, function* () {
                            if (!error) {
                                var parts = result.split('\n');
                                oldVersion = parts[0]; // line 1 - version
                                oldUrl = parts[1]; // line 2 - details url
                            }
                            blob.createBlockBlobFromText(azureContainer, filePath, newFileContent, function (error, result, response) {
                                return __awaiter(this, void 0, void 0, function* () {
                                    if (error) {
                                        tl.setResult(tl.TaskResult.Failed, "------------- Error in Azure Storage! (GetBlob)\n\nError: " + error.message);
                                        return;
                                    }
                                    var newVersionSem = removePrefix(newVersion);
                                    var oldVersionSem = removePrefix(oldVersion);
                                    isHotfix = (isHotfix != null || isHotfix != undefined) ? isHotfix.toLowerCase().trim() : "false";
                                    var isRollbackBool = isRollback(oldVersionSem, newVersionSem);
                                    var prefix = ":rocket: Deploy";
                                    var suffix = ":rocket:";
                                    if (isHotfix == "true") {
                                        prefix = ":ambulance: *[HOTFIX]* Deploy";
                                        suffix = ":ambulance:";
                                    }
                                    if (isRollbackBool == true) {
                                        prefix = ":boom: *[ROLLBACK]* Deploy";
                                        suffix = ":boom:";
                                    }
                                    if (newVersionSem == oldVersionSem) {
                                        prefix = ":hankey: *[REPEATED]* Deploy";
                                        suffix = ":hankey:";
                                    }
                                    if (oldVersion == "<unknow>") {
                                        prefix = ":baby::skin-tone-3: *[FIRST TIME]* Deploy";
                                        suffix = ":baby::skin-tone-3:";
                                    }
                                    // prepare message
                                    var message = `${prefix} Started for ${appName} in environment ${environment} ${suffix}`;
                                    var slackPayload = {
                                        text: message,
                                        icon_url: slackIcon,
                                        username: slackName,
                                        attachments: [
                                            {
                                                title: `:soon: New Version: ${newVersion}`,
                                                title_link: newUrl
                                            },
                                            {
                                                title: `:back: Rollback Version: ${oldVersion}`,
                                                title_link: oldUrl
                                            }
                                        ]
                                    };
                                    tl.setVariable("NEW_VERSION", newVersion);
                                    tl.setVariable("NEW_URL", newUrl);
                                    tl.setVariable("OLD_VERSION", oldVersion);
                                    tl.setVariable("OLD_URL", oldUrl);
                                    // send notification
                                    var resultSlack = yield axios.default.post(slackUrl, slackPayload);
                                    if (resultSlack.status < 200 || resultSlack.status >= 300) {
                                        tl.setResult(tl.TaskResult.SucceededWithIssues, `------------- Notification was returned ${resultSlack.status}`);
                                    }
                                });
                            });
                        });
                    });
                });
            });
        }
        catch (err) {
            tl.setResult(tl.TaskResult.Failed, err.message);
        }
    });
}
run();
