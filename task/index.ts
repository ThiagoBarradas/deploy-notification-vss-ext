import * as tl from 'azure-pipelines-task-lib/task';
import * as azStorage from 'azure-storage';
import * as axios from 'axios';
const { GoogleSpreadsheet } = require('google-spreadsheet');

function normalizeText(text)
{
    return text.normalize().toLowerCase().replace(/[^a-zA-Z]+/g, '');
}

function removePrefix(version)
{
    if (version != null)
    {
        return version.replace(/[^0-9\.]+/g, '');
    }

    return version;
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

async function addSheetsLine(sheetsId, email, privateKey, team, appName, environment, newVersion, oldVersion, isHotfix, isRollback, isRepeated, newUrl, oldUrl)
{
    console.log("adding sheets line...");
    if (sheetsId == null) return;

    var sk = privateKey.split("\\n").join("\n");

    var doc = new GoogleSpreadsheet(sheetsId);
    await doc.useServiceAccountAuth({
        client_email: email,
        private_key: sk
      });

    await doc.loadInfo(); 

    var sheet = doc.sheetsByIndex[0];

    var row = await sheet.addRow({ 
        DeployDate: formatDate(Date.now()),
        Team: team,
        AppName: appName,
        Environment: environment,
        NewVersion: newVersion,
        OldVersion: oldVersion,
        IsHotfix: isHotfix,
        IsRollback: isRollback,
        IsRepeated: isRepeated,
        NewUrl: newUrl,
        OldUrl: oldUrl
    });

    console.log("finish sheets line!");
}

function _formatDatetime(date: Date, format: string) {
    const _padStart = (value: number): string => value.toString().padStart(2, '0');
 return format
     .replace(/yyyy/g, _padStart(date.getUTCFullYear()))
     .replace(/dd/g, _padStart(date.getUTCDate()))
     .replace(/mm/g, _padStart(date.getUTCMonth() + 1))
     .replace(/hh/g, _padStart(date.getUTCHours()))
     .replace(/ii/g, _padStart(date.getUTCMinutes()))
     .replace(/ss/g, _padStart(date.getUTCSeconds()))
     .replace(/Z/g, "UTC");
 }

 function isValidDate(d: Date): boolean {
     return !isNaN(d.getTime());
 }

 function formatDate(date: any): string {
     var datetime = new Date(date);
     return isValidDate(datetime) ? _formatDatetime(datetime, 'yyyy-mm-dd hh:ii:ss Z') : '';
 }

function delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
}

function padLeft(text:string, padChar:string, size:number): string {
    return (String(padChar).repeat(size) + text).substr( (size * -1), size) ;
}

function isRollback(oldVersion, newVersion) : boolean
{
    if((oldVersion.match(/./g) || []).length != (newVersion.match(/./g) || []).length)
    {
        return false;
    }

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

    
    if (/^\d+.\d+$/.test(oldVersion) && /^\d+.\d+$/.test(newVersion)) 
    {
        var oldParts = oldVersion.split(".");
        var newParts = newVersion.split(".");

        var oldMajor = Number(oldParts[0]);
        var oldMinor = Number(oldParts[1]);

        var newMajor = Number(newParts[0]);
        var newMinor = Number(newParts[1]);

        if (newMajor > oldMajor) return false;
        if (oldMajor > newMajor) return true;

        return oldMinor > newMinor;
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
        var appName: string = tl.getInput('app_name', true);
        var environment: string = tl.getInput('environment', true);
        var newUrl: string = tl.getInput('new_url', true);
        var sheetsId: string = tl.getInput('sheets_id', false);
        var sheetsEmail: string = tl.getInput('sheets_email', false);
        var sheetsPrivateKey: string = tl.getInput('sheets_private_key', false);
        var team: string = tl.getInput('team', false);
        
        var appNameNormalized = `${normalizeText(appName)}.${normalizeText(environment)}`;
        console.log(`environment: ${environment}`);
        console.log(`appName: ${appName}`);
        console.log(`appNameNormalized: ${appNameNormalized}`);
        console.log(`isHotfix: ${isHotfix}`);

        if (team != null)
        {
            team = team.split(' ')[0];
        }

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

                    var newVersionSem = removePrefix(newVersion);
                    var oldVersionSem = removePrefix(oldVersion);

                    var prefix = ":rocket: Deploy";
                    var suffix = ":rocket:";

                    isHotfix = (isHotfix != null || isHotfix != undefined) ? isHotfix.toLowerCase().trim() : "false" ;
                    var isHotfixBool = (isHotfix == "true");
                    if (isHotfixBool)
                    {
                        prefix = ":ambulance: *[HOTFIX]* Deploy";
                        suffix = ":ambulance:";
                    }

                    var isRollbackBool = isRollback(oldVersionSem, newVersionSem);
                    if (isRollbackBool == true)
                    {
                        prefix = ":boom: *[ROLLBACK]* Deploy";
                        suffix = ":boom:";
                    }

                    var isRepeated = (newVersionSem == oldVersionSem);
                    if (isRepeated)
                    {
                        prefix = ":hankey: *[REPEATED]* Deploy";
                        suffix = ":hankey:";
                    }
                    
                    var isFirstTime = (oldVersion == "<unknow>");
                    if (isFirstTime)
                    {
                        prefix = ":baby::skin-tone-3: *[FIRST TIME]* Deploy";
                        suffix = ":baby::skin-tone-3:";
                    }

                    // prepare message
                    var message = `${prefix} Started for ${appName} in environment ${environment} | Team: ${team} ${suffix}`;
                            
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
                    
                    // add sheets report
                    await addSheetsLine(sheetsId, sheetsEmail, sheetsPrivateKey, team, appName, environment, newVersion, oldVersion, isHotfixBool, isRollbackBool, isRepeated, newUrl, oldUrl);

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
