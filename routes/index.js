var fs = require("fs");
var express = require('express');
var router = express.Router();
require('dotenv').config()

var dailyTimer = null;
var settings = {}

const Shopify = require('shopify-api-node')
const shopify = new Shopify({
  shopName: process.env.STORE_URL,
  apiKey: process.env.STORE_API_KEY,
  password: process.env.STORE_PASSWORD,
  timeout: 50000,
  autoLimit: {
      calls: 2,
      interval: 1000,
      bucketSize: 35
  }
});

/* GET home page. */
router.get('/', async (req, res) => {
  fs.readFile("data.json", function(err, buf) {
    if (err) {
      console.log(err)
    } else {
      settings = JSON.parse(buf.toString());
      res.status(200).json(settings);
      console.log(settings.endTag);
    }
  });
});

// Start command
router.get('/startTimer', async (req, res) => {
  settings.status = 'started';
  await writeSettings(JSON.stringify(settings));
  res.redirect('/')
  // const productList = await getProductList(shopify);
  // dailyTimer = setInterval(updateTags(productList), 86400000)
})

// Stop command
router.get('/stopTimer', async (req, res) => {
  settings.status = 'stopped';
  await writeSettings(JSON.stringify(settings));
  clearInterval(dailyTimer)
  res.redirect('/')
})

async function writeSettings(data) {
  fs.writeFile("data.json", data, (err) => {
    if (err) {
      console.log(err);
      return false
    } else {
      console.log("Successfully Written to File.");
      return true
    }
  })
}

async function getProductList() {
  let params = { limit: 50, fields: ['id', 'handle', 'tags'] };
  let products = new Array(0);
  do {
    const productListPiece = await shopify.product.list(params);
    products.push(...productListPiece)
    params = productListPiece.nextPageParameters;
  } while (params !== undefined);

  return products;
}

function updateTags(products) {
  products.map(async pr => {
    const metafields = await shopify.metafield.list({metafield: {owner_resource: 'product', owner_id: pr.id}});
    metafields.map(mf => {
      if (mf.namespace === 'c_f' && mf.key === 'countdown_timer') {
        const metaDate = new Date(mf.value);
        const currentDate = new Date()
        let productTags = pr.tags.split(', ')
        
        if (currentDate.getTime() < metaDate.getTime()) { // during countdown
          if(!productTags.includes('countdown')) {
            productTags.push('countdown');
          }
        } else { // ended of countdown
          productTags.remove('countdown');
          if(!productTags.includes('countdown-end')) {
            productTags.push('countdown-end');
          }
        }
        shopify.product.update(pr.id, {
          tags: productTags.join(', ')
        }).then(result => console.log('tag update result: ', result.id, result.tags))
      }
    })
  })
}

Array.prototype.remove = function() {
  var what, a = arguments, L = a.length, ax;
  while (L && this.length) {
      what = a[--L];
      while ((ax = this.indexOf(what)) !== -1) {
          this.splice(ax, 1);
      }
  }
  return this;
};

module.exports = router;
