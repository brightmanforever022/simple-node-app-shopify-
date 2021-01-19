function startUpdate() {
  window.location.href = '/starttimer';
}

function stopUpdate() {
  if (confirm('Are you sure that you delete this store?')) {
    console.log('Are you really Okay with Stopping the update?');
    window.location.href = '/stoptimer';
  } else {
    console.log('There are no any actions here');
  }
}

$(document).ready(function() {
  setTimeout(function() {
    $('.success_message').fadeOut('fast');
  }, 3000);
})