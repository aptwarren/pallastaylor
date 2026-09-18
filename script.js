document.getElementById('year').textContent = new Date().getFullYear();

const eventForm = document.getElementById('event-form');
if (eventForm) {
  eventForm.addEventListener('submit', function (event) {
    event.preventDefault();
    document.getElementById('form-status').textContent = 'Thanks — your event details are ready to send once this site is connected to an inbox.';
  });
}
