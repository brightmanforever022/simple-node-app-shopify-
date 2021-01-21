var fs = require("fs");
var express = require('express');
var router = express.Router();
require('dotenv').config()
var mysql = require('mysql');
var nodemailer = require('nodemailer');

var dailyTimer = null;
var settings = {
  duringTag: 'countdown',
  endedTag: 'countdown-end',
  status: 'stopped'
}

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

var connection = mysql.createConnection(process.env.CLEARDB_DATABASE_URL)

/* GET home page. */
router.get('/', async (req, res) => {
  connection.query("SELECT * FROM settings", (err, results) => {
    if (err) {
      console.log(err)
    } else {
      settings = {
        duringTag: results[0].during_tag,
        endedTag: results[0].ended_tag,
        status: results[0].status ? "started" : "stopped"
      }
      res.render('index', {page: 'index', data: settings});
      console.log(results[0]);
    }
  })
});

router.post('/', async (req, res) => {
  const data = JSON.parse(JSON.stringify(req.body))
  settings.duringTag = data.duringTag;
  settings.endedTag = data.endedTag;
  await updateSettings();
  res.redirect('/')
})

// Start command
router.get('/starttimer', async (req, res) => {
  settings.status = 'started';
  await writeSettings();
  setTimeout(dailyProcess, 5000)
  dailyTimer = setInterval(dailyProcess, 86400000)
  res.redirect('/')
})

// Stop command
router.get('/stoptimer', async (req, res) => {
  settings.status = 'stopped';
  await writeSettings();
  clearInterval(dailyTimer)
  res.redirect('/')
})

async function writeSettings(data) {
  const settingStatus = settings.status === 'stopped' ? 0 : 1;
  connection.query("UPDATE settings SET during_tag=?, ended_tag=?, status=?", [settings.duringTag, settings.endedTag, settingStatus], (err, results) => {
    if (err) {
      console.log(err);
      return false
    } else {
      console.log("Successfully Written to File.");
      return true
    }
  })
}

async function dailyProcess() {
  try {
    const productList = await getProductList(shopify);
    updateTags(productList)
  } catch (error) {
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
    transporter.sendMail(mailOptions, function(error, info){
      if (error) {
        console.log(error);
      } else {
        console.log('Email sent: ' + info.response);
      }
    });    
  }
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
