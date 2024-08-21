const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const app = express();
const port = 5000;

app.use(express.json());
app.use(require('cors')());

// Helper function to get page content
const getPageContent = async (url, includeUhf) => {
  try {
    const { data } = await axios.get(url);
    let $ = cheerio.load(data);

    if (!includeUhf) {
      const primaryAreaContent = $('main.microsoft-template-layout-container').html();
      $ = cheerio.load(primaryAreaContent || '');
    }

    return $;
  } catch (error) {
    console.error('Error fetching page:', error.message);
    return null;
  }
};

// Helper function to determine color based on status code
const getStatusColor = (statusCode) => {
  if (statusCode >= 500) return 'red'; // Server errors
  if (statusCode >= 400) return 'orange'; // Client errors
  if (statusCode >= 300) return 'yellow'; // Redirects
  return 'green'; // Successful responses
};

// Helper function to process links
const processLink = async (link, $) => {
  const href = $(link).attr('href');
  const text = $(link).text().trim();
  const ariaLabel = $(link).attr('aria-label');
  const target = $(link).attr('target');
  const classNames = $(link).attr('class') || '';
  let linkType = 'unknown';

  if (classNames.includes('cta')) {
    linkType = 'cta';
  } else if (classNames.includes('button')) {
    linkType = 'button';
  } else if (classNames.includes('link')) {
    linkType = 'link';
  }

  let linkDetails = {
    linkType: linkType,
    linkText: text,
    ariaLabel: ariaLabel || '',
    url: href,
    redirectedUrl: '',
    statusCode: 200,
    target: target || '',
    statusColor: 'green', // Default color
    originalUrlColor: '',
    redirectedUrlColor: '',
  };

  if (href) {
    try {
      const response = await axios.get(href);
      linkDetails.statusCode = response.status;
      linkDetails.redirectedUrl = response.request.res.responseUrl;
      linkDetails.statusColor = getStatusColor(response.status);

      // Color the URLs if they differ
      if (href !== linkDetails.redirectedUrl) {
        linkDetails.originalUrlColor = 'blue';
        linkDetails.redirectedUrlColor = 'purple';
      }
    } catch (error) {
      if (error.response) {
        linkDetails.statusCode = error.response.status;
        linkDetails.statusColor = getStatusColor(error.response.status);
      }
    }
  }

  return linkDetails;
};

// All details routes
app.post('/extract-urls', async (req, res) => {
  const { url, includeUhf } = req.body;
  const $ = await getPageContent(url, includeUhf);
  if (!$) return res.status(500).send('Failed to fetch page content.');

  const urls = $('a[href]')
    .map((_, element) => $(element).attr('href'))
    .get()
    .filter(href => href.startsWith('http'));

  res.json({ urls });
});

app.post('/link-details', async (req, res) => {
  const { url, includeUhf } = req.body;
  const $ = await getPageContent(url, includeUhf);
  if (!$) return res.status(500).send('Failed to fetch page content.');

  const linkElements = $('a').toArray();
  const linkPromises = linkElements.map(link => processLink(link, $));
  const results = await Promise.all(linkPromises);
  res.json({ links: results });
});

app.post('/image-details', async (req, res) => {
  const { url, includeUhf } = req.body;
  const $ = await getPageContent(url, includeUhf);
  if (!$) return res.status(500).send('Failed to fetch page content.');

  const images = [];
  $('img').each((_, element) => {
    const src = $(element).attr('src');
    if (src) { // Only include images with a src attribute
      const alt = $(element).attr('alt');
      images.push({
        imageName: src,
        alt: alt || 'No Alt Text',
        hasAlt: !!alt,
      });
    }
  });

  res.json({ images });
});

app.post('/video-details', async (req, res) => {
  const { url } = req.body;
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url);

  const videoDetails = await page.evaluate(() => {
    const videoDetailsList = [];

    // Get all universal-media-player elements
    const videoElements = document.querySelectorAll("universal-media-player");

    videoElements.forEach(videoElement => {
      // Get the options attribute as a JSON object
      const options = JSON.parse(videoElement.getAttribute("options"));

      // Check if an audio track is present
      const audioTrackPresent = videoElement.querySelector('.vjs-main-desc-menu-item') ? "yes" : "no";

      // Extract the desired information
      const videoDetail = {
        transcript: options.downloadableFiles
          .filter(file => file.mediaType === "transcript")
          .map(file => file.locale),
        cc: options.ccFiles.map(file => file.locale),
        autoplay: options.autoplay ? "yes" : "no",
        muted: options.muted ? "yes" : "no",
        ariaLabel: options.ariaLabel || options.title || "",
        audioTrack: audioTrackPresent,
      };

      videoDetailsList.push(videoDetail);
    });

    return videoDetailsList;
  });

  await browser.close();
  res.json({ videos: videoDetails });
});

app.post('/page-properties', async (req, res) => {
  const { url, includeUhf } = req.body;
  try {
    const $ = await getPageContent(url, includeUhf);
    if (!$) return res.status(500).send('Failed to fetch page content.');

    const metaTags = [];
    $('meta').each((_, meta) => {
      const name = $(meta).attr('name');
      const property = $(meta).attr('property');
      const content = $(meta).attr('content');
      if (name || property) {
        metaTags.push({
          name: name || property,
          content: content || 'No Content',
        });
      }
    });

    res.json({ metaTags });
  } catch (error) {
    console.error('Error in /page-properties route:', error.message);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/heading-hierarchy', async (req, res) => {
  const { url, includeUhf } = req.body;
  const $ = await getPageContent(url, includeUhf);
  if (!$) return res.status(500).send('Failed to fetch page content.');

  const headings = [];
  $('h1, h2, h3, h4, h5, h6').each((_, heading) => {
    headings.push({
      level: heading.tagName,
      text: $(heading).text().trim(),
    });
  });

  res.json({ headings });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});