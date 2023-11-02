import browser from 'webextension-polyfill';

const Rule1 = {
    id: 1,
    condition: {
        initiatorDomains: [browser.runtime.id],
        resourceTypes: ['xmlhttprequest'],
    },
    action: {
        type: 'modifyHeaders',
        requestHeaders: [
            { header: 'Sec-Fetch-Dest', operation: 'remove' },
            { header: 'Sec-Fetch-Mode', operation: 'remove' },
            { header: 'Sec-Fetch-Site', operation: 'remove' },
            { header: 'User-Agent', operation: 'remove' },
            { header: 'Origin', operation: 'remove' },
            { header: 'Content-Type', operation: 'remove' },
            { header: 'X-Amz-Cf-Id', operation: 'remove' },
        ],
    }
};

let Rule2 = {
    id: 2
}

const webUrl = "https://www.native-video.com";
const appUrl = "https://app.native-video.com";
let shouldProxy = true;

function generateUniqueId() {
    return Math.random().toString(36).substring(2);
}

async function init(id, linkUrl) {
    try {
        const tab = await browser.tabs.create({ url: `${webUrl}/loading.html` });
        
        const initUrl = `${appUrl}/?init=${id}&incoming_url=${encodeURIComponent(linkUrl)}`;
        const response = await fetch(initUrl);
        const body = await response.json();
        
        if (body.url) {
            browser.tabs.create({ url: body.url });
        } else {
            browser.tabs.create({ url: `${webUrl}/error.html` });
        }
        
        browser.tabs.remove(tab.id);
    } catch (ex) {
        await chrome.tabs.remove(tab.id);
        browser.tabs.create({ url: `${webUrl}/error.html` });
        console.error('init:error', ex.message);
    } finally {
        shouldProxy = false;
    }
}

async function proxy(id) {
    const requestUrl = `${appUrl}/?request=${id}`
    const responseUrl = `${appUrl}/?response=${id}`

    while (shouldProxy) {
        try {
            const request = await fetch(requestUrl);
            const { body, url, method, headers } = await request.json();
            
            const requestHeaders = Object.entries(headers).map(([header, value]) => ({
                header: header,
                value: value,
                operation: 'set'
            }));

            Rule2 = {
                id: 2,
                condition: {
                    initiatorDomains: [browser.runtime.id],
                    resourceTypes: ['xmlhttprequest'],
                },
                action: {
                    type: 'modifyHeaders',
                    requestHeaders,
                }
            };

            await browser.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: [Rule1.id, Rule2.id],
                addRules: [Rule1, Rule2],
            });

            const response = ['get', 'head'].includes(method.toLowerCase())
                ? await fetch(url, { method })
                : await fetch(url, { body, method });
            
            const responseHeaders = {};
            for (const [key, value] of response.headers.entries()) {
                if (value.toLowerCase().includes('gzip')) {
                    continue;
                }
                responseHeaders[key] = value;
            }
            const responseText = await response.text();

            const data = {
                headers: responseHeaders,
                body: responseText
            }
            console.log({ data })

            await browser.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: [Rule1.id, Rule2.id],
            });

            await fetch(responseUrl, { 
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });
        } catch (ex) {
            shouldProxy = false;
            console.error('init:proxy', ex.message);
        }
    }
}

browser.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'install' && details.reason !== 'update') return;

    browser.contextMenus.create({
        id: 'native-video',
        title: 'Native Video',
        contexts: ['link']
    });

    browser.contextMenus.onClicked.addListener(async (info, tab) => {
        await browser.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [Rule1.id, Rule2.id],
        });

        const id = generateUniqueId();
        shouldProxy = true;

        const [result1, result2] = await Promise.all([init(id, info.linkUrl), proxy(id)]);
    });
});

/********************* inactive sw *****************/

const storageArea = browser.storage.local;
const TEST_INTERVAL_MS = 10000;
const STORAGE_WAIT_TIME_MS = 100;

/**
 * @see https://bugs.chromium.org/p/chromium/issues/detail?id=1316588
 */
const hasChromiumIssue1316588 = () => {
  return new Promise((resolve) => {
    let dispatched = false;

    const testEventDispatching = () => {
      storageArea.onChanged.removeListener(testEventDispatching);
      dispatched = true;
    };

    storageArea.onChanged.addListener(testEventDispatching);
    storageArea.set({ testEventDispatching: Math.random() });

    setTimeout(() => resolve(!dispatched), STORAGE_WAIT_TIME_MS);
  });
};

const fixChromiumIssue1316588 = async () => {
  const hasIssue = await hasChromiumIssue1316588();

  if (hasIssue) {
    chrome.runtime.reload();
  } else {
    setTimeout(fixChromiumIssue1316588, TEST_INTERVAL_MS);
  }
};

// Call the initial function
fixChromiumIssue1316588();