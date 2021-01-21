var fs = require("fs");
var express = require('express');
var router = express.Router();
require('dotenv').config()
// var mysql = require('mysql');
var nodemailer = require('nodemailer');

var dailyTimer;
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
      interval: 1000,
      bucketSize: 35
  }
});

var stopInterval;

// var connection;
// function handleDisconnect() {
//   connection = mysql.createConnection(process.env.CLEARDB_DATABASE_URL); // Recreate the connection, since
//                                                   // the old one cannot be reused.

//   connection.connect(function(err) {              // The server is either down
//     if(err) {                                     // or restarting (takes a while sometimes).
//       console.log('error when connecting to db:', err);
//       setTimeout(handleDisconnect, 2000); // We introduce a delay before attempting to reconnect,
//     }                                     // to avoid a hot loop, and to allow our node script to
//   });                                     // process asynchronous requests in the meantime.
//                                           // If you're also serving http, display a 503 error.
//   connection.on('error', function(err) {
//     if(err.code === 'PROTOCOL_CONNECTION_LOST') { // Connection to the MySQL server is usually
//       handleDisconnect();                         // lost due to either server restart, or a
//     } else {                                      // connnection idle timeout (the wait_timeout
//       throw err;                                  // server variable configures this)
//     }
//   });
// }

// handleDisconnect();

/* GET home page. */
router.get('/', async (req, res) => {
  clearInterval(stopInterval);
  stopInterval = setInterval(stopIdle, 300000);
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
  setTimeout(dailyProcess, 5000);
  dailyTimer = setInterval(dailyProcess, 86400000);
  res.redirect('/');
})

// Stop command
router.get('/stoptimer', async (req, res) => {
  settings.status = 'stopped';
  await writeSettings();
  clearInterval(dailyTimer);
  res.redirect('/');
})

async function writeSettings() {
  // const settingStatus = settings.status === 'stopped' ? 0 : 1;
  // connection.query("UPDATE settings SET during_tag=?, ended_tag=?, status=?", [settings.duringTag, settings.endedTag, settingStatus], (err, results) => {
  //   if (err) {
  //     console.log(err);
  //     return false;
  //   } else {
  //     console.log("Successfully changed the status.");
  //     return true;
  //   }
  // })
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

async function stopIdle() {
  const duringMetaData = await shopify.metafield.get(settings.duringMetaId);
  console.log('stop idle: ', duringMetaData.id)
}

module.exports = router;
