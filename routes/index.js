require('dotenv').config()
var dateFormat = require('dateformat')
var fs = require("fs");
var express = require('express');
var router = express.Router();
var nodemailer = require('nodemailer');
var CronJob = require('cron').CronJob;

var dailyJob;
var settings = {
  duringTag: 'countdown',
  endedTag: 'countdown-end',
  status: 'stopped',
  duringMetaId: 13488352264294,
  endedMetaId: 13488353443942,
  statusMetaId: 13488354164838
};

const Shopify = require('shopify-api-node')
const shopify = new Shopify({
  shopName: process.env.STORE_URL,
  apiKey: process.env.STORE_API_KEY,
  password: process.env.STORE_PASSWORD,
  timeout: 50000,
  autoLimit: {
      calls: 2,
      interval: 2000,
      bucketSize: 35
  }
});

/* GET home page. */
router.get('/', async (req, res) => {
  const metaData = await shopify.metafield.list({metafield: {owner_resource: 'product', owner_id: 4989807394918}})
  metaData.map(md => {
    if(md.namespace === 'tagSettings') {
      if(md.key === "duringTag") {
        settings.duringTag = md.value
      }
      if(md.key === "endedTag") {
        settings.endedTag = md.value
      }
      if(md.key === "status") {
        settings.status = md.value
      }
    }
  })
  console.log('settings: ', settings)
  res.render('index', {page: 'index', data: settings})
});

router.post('/', async (req, res) => {
  const data = JSON.parse(JSON.stringify(req.body));
  settings.duringTag = data.duringTag;
  settings.endedTag = data.endedTag;
  await writeSettings();
  res.redirect('/');
})

// Start command
router.get('/starttimer', async (req, res) => {
  settings.status = 'started';
  await writeSettings();
  dailyJob = new CronJob(
    '0 0 0 * * *', dailyProcess,
    null, true, 'America/Los_Angeles'
  );
  dailyJob.start();
  res.redirect('/');
})

// Stop command
router.get('/stoptimer', async (req, res) => {
  settings.status = 'stopped';
  await writeSettings();
  dailyJob.stop();
  res.redirect('/');
})

// Get webhook from store
router.post('/orderCreated', async (req, res) => {
  res.status(200).send('received');
  var createdOrderInfo = req.body;
  await sleep(1000);
  var orderTags = createdOrderInfo.tags;
  var lineItems = createdOrderInfo.line_items;
  var productIdList = lineItems.map(lineItem => lineItem.product_id);
  productIdList = productIdList.filter(idItem => !!idItem);
  const orderId = createdOrderInfo.id;
  const productId = productIdList.length > 0 ? productIdList[0] : null;
  
  // productId = 4991417876582
  if(!!productId) {
    const metafields = await shopify.metafield.list({metafield: {owner_resource: 'product', owner_id: productId}});
    metafields.map(mf => {
      if (mf.namespace === 'c_f' && mf.key === 'countdown_timer') {
        const metaDate = new Date(mf.value);
        const orderMetaDate = dateFormat(metaDate, 'mm-dd-yyyy')
        orderTags = orderTags.split(', ').push(orderMetaDate.toString()).join(', ')
        shopify.order.update(orderId, {
          tags: orderTags
        }).then(result => console.log('tag update result: ', result.id, result.tags));
      }
    });
  }
})

async function writeSettings() {
  await shopify.metafield.update(settings.duringMetaId, {
    value: settings.duringTag,
    value_type: 'string'
  });
  await shopify.metafield.update(settings.endedMetaId, {
    value: settings.endedTag,
    value_type: 'string'
  });
  await shopify.metafield.update(settings.statusMetaId, {
    value: settings.status,
    value_type: 'string'
  })
  return true;
}

async function dailyProcess() {
  try {
    const productList = await getProductList(shopify);
    updateTags(productList);
  } catch (error) {
    console.log('daily process error: ', error);
    sendMail();
  }
}

async function getProductList() {
  let params = { limit: 50, fields: ['id', 'handle', 'tags'] };
  let products = new Array(0);
  try {
    do {
      const productListPiece = await shopify.product.list(params);
      products.push(...productListPiece);
      console.log('got 50 products');
      params = productListPiece.nextPageParameters;
    } while (params !== undefined);    
  } catch (error) {
    console.log('get product list error: ', error)
    sendMail();
  }

  return products;
}

function updateTags(products) {
  console.log('------got all products-----');
  products.map(async pr => {
    try {
      const metafields = await shopify.metafield.list({metafield: {owner_resource: 'product', owner_id: pr.id}});
      metafields.map(mf => {
        if (mf.namespace === 'c_f' && mf.key === 'countdown_timer') {
          const metaDate = new Date(mf.value);
          const currentDate = new Date();
          let productTags = pr.tags.split(', ');
          
          if (currentDate.getTime() < metaDate.getTime()) { // during countdown
            if(!productTags.includes(settings.duringTag)) {
              productTags.push(settings.duringTag);
            }
          } else { // ended of countdown
            productTags.remove(settings.duringTag);
            if(!productTags.includes(settings.endedTag)) {
              productTags.push(settings.endedTag);
            }
          }
          shopify.product.update(pr.id, {
            tags: productTags.join(', ')
          }).then(result => console.log('tag update result: ', result.id, result.tags));
        }
      });      
    } catch (error) {
      console.log('product update error: ', error)
      sendMail();
    }
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

function sendMail() {
  var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SERVICE_MAIL_ADDRESS,
      pass: process.env.SERVICE_MAIL_PASSWORD
    }
  });
  var mailOptions = {
    from: process.env.FROM_EMAIL,
    to: process.env.TO_EMAIL,
    subject: 'error generated',
    text: 'Please check the app related with the tag updating! There are some errors!'
  };
  transporter.sendMail(mailOptions, function(err, info){
    if (err) {
      console.log(err);
    } else {
      console.log('Email sent: ' + info.response);
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

module.exports = router;
