document.getElementById('year').textContent = new Date().getFullYear();

const eventForm = document.getElementById('event-form');
if (eventForm) {
  eventForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    const status = document.getElementById('form-status');
    const button = eventForm.querySelector('button[type="submit"]');
    status.textContent = 'Sending...';
    button.disabled = true;

    try {
      const response = await fetch('https://formsubmit.co/ajax/ariellewarren99@gmail.com', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: new FormData(eventForm)
      });
      if (!response.ok) throw new Error('Submission failed');
      eventForm.reset();
      status.textContent = 'Thanks — we received your event details and will be in touch.';
    } catch (error) {
      status.textContent = 'Something went wrong. Please try again or email ariellewarren99@gmail.com.';
    } finally {
      button.disabled = false;
    }
  });
}
