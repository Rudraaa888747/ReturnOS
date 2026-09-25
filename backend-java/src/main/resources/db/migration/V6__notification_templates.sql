INSERT INTO notification_templates(key,title,body,active,updated_at) VALUES
 ('TICKET_REPLIED','New reply on ticket {{ticket_number}}','Support replied to your ticket {{ticket_number}}. Open it to read the response.',true,now()),
 ('TICKET_CLOSED','Ticket {{ticket_number}} closed','Your support ticket {{ticket_number}} was closed. Reply to reopen it.',true,now())
ON CONFLICT(key) DO NOTHING;
