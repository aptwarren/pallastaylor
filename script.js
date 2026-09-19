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

const menuToggle = document.querySelector('.menu-toggle');
const mobileMenu = document.getElementById('mobile-menu');
if (menuToggle && mobileMenu) {
  const closeMenu = () => {
    mobileMenu.hidden = true;
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation menu');
  };
  menuToggle.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') === 'true';
    if (open) { closeMenu(); return; }
    mobileMenu.hidden = false;
    menuToggle.setAttribute('aria-expanded', 'true');
    menuToggle.setAttribute('aria-label', 'Close navigation menu');
  });
  mobileMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  document.addEventListener('click', e => {
    if (!mobileMenu.hidden && !mobileMenu.contains(e.target) && !menuToggle.contains(e.target)) closeMenu();
  });
}
