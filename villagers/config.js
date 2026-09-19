/* Villagers backend config. The anon key is public-by-design:
   it can only do what Row Level Security allows (host reads after
   sign-in; guests can only read/submit via the RSVP RPCs). */
const SB_URL = "https://ggnygyxsgstmxbydzqdm.supabase.co";
const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnbnlneXhzZ3N0bXhieWR6cWRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3NTkzNzUsImV4cCI6MjEwNTMzNTM3NX0.1Cw038l-SbksTzLeUkTHeaon6-1gm95Pai1d72N02Q0";
const sb = window.supabase.createClient(SB_URL, SB_ANON);
