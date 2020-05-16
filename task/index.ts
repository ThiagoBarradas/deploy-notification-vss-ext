import * as tl from 'azure-pipelines-task-lib/task';
import * as azStorage from 'azure-storage';
import * as axios from 'axios';


function normalizeText(text)
{
    return text.normalize().toLowerCase().replace(/[^a-zA-Z]+/g, '');
}

function sendRequest(method, url, data, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    if (callback) xhr.onload = function() { callback(JSON.parse(this['responseText'])); };
    if (data != null) {
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(data));
    }
    else xhr.send();
}

function delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
}

function padLeft(text:string, padChar:string, size:number): string {
    return (String(padChar).repeat(size) + text).substr( (size * -1), size) ;
}

function isRollback(oldVersion, newVersion) : boolean
{
    if (/^\d+.\d+.\d+$/.test(oldVersion) && /^\d+.\d+.\d+$/.test(newVersion))
    {
        var oldParts = oldVersion.split(".");
        var newParts = newVersion.split(".");

        var oldMajor = Number(oldParts[0]);
        var oldMinor = Number(oldParts[1]);
        var oldPatch = Number(oldParts[2]);

        var newMajor = Number(newParts[0]);
        var newMinor = Number(newParts[1]);
        var newPatch = Number(newParts[2]);

        if (newMajor > oldMajor) return false;
        if (oldMajor > newMajor) return true;

        if (newMinor > oldMinor) return false;
        if (oldMinor > newMinor) return true;

        return oldPatch > newPatch;
    }

    return false;
}

async function run() {
    try {
        // declare
        var slackUrl: string = tl.getInput('slack_url', true);
        var newVersion: string = tl.getInput('new_version', true);
        var azureConnString: string = tl.getInput('azure_conn', true);
        var azureContainer: string = tl.getInput('azure_container', true);
        var isHotfix: string = tl.getInput('is_hotfix', false);

        var appName = tl.getVariable("SYSTEM_DEFINITIONNAME");
        var environment = tl.getVariable("RELEASE_ENVIRONMENTNAME");
        var newUrl = tl.getVariable("RELEASE_RELEASEWEBURL");

        var appNameNormalized = `${normalizeText(appName)}.${normalizeText(environment)}`;
        console.log(`appNameNormalized: ${environment}`);
        console.log(`appNameNormalized: ${appNameNormalized}`);

        var slackName = "Azure DevOps"
        var slackIcon = "https://i.imgur.com/YsiCtzd.png"  

        var filePath = appNameNormalized + ".txt";
        var newFileContent = 
            newVersion + "\n" +  // line 1 - version
            newUrl;              // line 2 - details url

        var oldVersion = "<unknow>";
        var oldUrl = newUrl;

        // conn azure storage
        var blob = azStorage.createBlobService(azureConnString);

        await blob.createContainerIfNotExists(azureContainer, async function(error, result, response) {
            if (error) {
                tl.setResult(tl.TaskResult.Failed, "------------- Error in Azure Storage (CreateContainer)! \n\nError: " + error.message);
                return;
            }

            blob.getBlobToText(azureContainer, filePath, async function(error,  result, response) {
                if (!error) {
                    var parts = result.split('\n');
                    oldVersion = parts[0]; // line 1 - version
                    oldUrl =     parts[1]; // line 2 - details url
                }
    
                blob.createBlockBlobFromText(azureContainer, filePath, newFileContent, async function(error, result, response){
                    if(error){
                        tl.setResult(tl.TaskResult.Failed, "------------- Error in Azure Storage! (GetBlob)\n\nError: " + error.message);
                        return;
                    }

                    isHotfix = (isHotfix != null || isHotfix != undefined) ? isHotfix.toLowerCase().trim() : "false" ;
                    var isRollbackBool = isRollback(oldVersion, newVersion);

                    var prefix = ":rocket: Deploy";
                    var suffix = ":rocket:";

                    if (isHotfix == "true")
                    {
                        prefix = ":ambulance: *[HOTFIX]* Deploy";
                        suffix = ":ambulance:";
                    }
                    if (isRollbackBool == true)
                    {
                        prefix = ":boom: *[ROLLBACK]* Deploy";
                        suffix = ":boom:";
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
                    var resultSlack = await axios.default.post(slackUrl, slackPayload);
                    if (resultSlack.status < 200 || resultSlack.status >= 300) {
                        tl.setResult(tl.TaskResult.SucceededWithIssues, `------------- Notification was returned ${resultSlack.status}`);
                    }
                });
            });
        });
    }
    catch (err) {
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

run();
