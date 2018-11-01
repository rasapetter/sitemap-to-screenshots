const puppeteer = require('puppeteer');
const { parseString } = require('xml2js');
const request = require('request');
const { stat, writeFile } = require('fs');
const { mkdirp } = require('fs-extra');
const path = require('path');

const BASE_URL = 'https://example.com';
const SITEMAP_URL = 'https://example.com/sitemap_index.xml';
const OUTPUT_DIR = path.join(process.cwd(), 'screenshots');
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36';

// Ensure outputdir exists
const createDir = async dir => {
  const outputFolder = await new Promise(resolve => stat(dir, (err, stats) => {
    resolve(stats);
  }));
  if (!outputFolder) {
    console.log('creating folder', dir);
    await new Promise((resolve, reject) => mkdirp(dir, err => {
      if (err) return reject(err);
      resolve();
    }));
  }
};

const getXMLObjectFromUrl = async url => {
  const body = await new Promise((resolve, reject) => {
    request(url, (error, response, body) => {
      if (error) return reject(error);
      resolve(body);
    });
  });

  return new Promise((resolve, reject) => {
    parseString(body, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
  });
};

const getUrlsFromSitemapUrl = async sitemapUrl => {
  let urls = [];

  const downloadAndParseSitemap = async _sitemapUrl => {
    console.log('fetching', _sitemapUrl);
    const xmlObject = await getXMLObjectFromUrl(_sitemapUrl);
    if (xmlObject.urlset && xmlObject.urlset.url) {
      xmlObject.urlset.url.forEach(url => {
        urls.push(url.loc[0]);
      });
    } else if (xmlObject.sitemapindex && xmlObject.sitemapindex.sitemap) {
      // recursion! sitemap contains child sitemaps
      for (const { loc } of xmlObject.sitemapindex.sitemap) {
        if (!loc.length) continue;
        await downloadAndParseSitemap(loc[0]);
      }
    }
  };
  //console.log(xmlObject);
  await downloadAndParseSitemap(sitemapUrl);

  // Ditch duplicates (shouldn't be any) and sort
  urls = urls.filter((v, i, a) => a.indexOf(v) === i);
  urls.sort();

  return urls;
};

const downloadScreeshotOfPageUrl = async (url, targetDir = '') => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  let filename = url.replace(/https:/, '');
  filename = filename.replace(/\./g, '-').replace(/\//g, '---') + '.png';

  // Create output directory
  await createDir(path.join(targetDir));

  console.log('making a screenshot of', url);
  await page.goto(url, {waitUntil: 'networkidle2'});
  page.setUserAgent(USER_AGENT);
  await page.setViewport({
    width: 1280,
    height: 720
  });

  // https://github.com/GoogleChrome/puppeteer/issues/703
  const bodyHandle = await page.$('body');
  const { width, height } = await bodyHandle.boundingBox();
  const screenshot = await page.screenshot({
    path: path.join(targetDir, filename),
    clip: {
      x: 0,
      y: 0,
      width,
      height
    },
    type: 'png'
  });
  await bodyHandle.dispose();

  await browser.close();
  console.log('saved screenshot as', filename);

  return filename;
};

(async () => {
  const urls = await getUrlsFromSitemapUrl(SITEMAP_URL);

  const prefix = (new Date()).toISOString().replace(/-/g, '').replace('T', '-').replace(/:/g, '').replace(/\.\d+/, '').replace('Z', '');

  console.log('downloading', urls.length, 'pages to', path.join(OUTPUT_DIR, prefix));

  const result = [];
  for (const url of urls) {
    try {
      const filename = await downloadScreeshotOfPageUrl(url, path.join(OUTPUT_DIR, prefix));
      result.push({
        url: url,
        filename: filename,
      });
    } catch (err) {
      console.log('failed on', url);
      console.log(err);
    }
  }

  await new Promise((resolve, reject) => {
    writeFile(path.join(OUTPUT_DIR, prefix, 'pages.json'), JSON.stringify(result), 'utf8', err => {
      if (err) return reject(err);
      return resolve();
    });
  });
  return 'done';
})();
