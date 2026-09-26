-- Demo baseline (catalogue, categories, demo accounts, seeded orders +
-- return). Idempotent: safe to apply over any database. Stock is never
-- restocked here; inventory buckets are only created when missing.

-- Categories ---------------------------------------------------------------
INSERT INTO categories(id,name,description,sort_order,active) VALUES
 ('c-footwear','Footwear','Shoes and boots for road and trail.',1,true),
 ('c-apparel','Apparel','Denim, tees and everyday clothing.',2,true),
 ('c-accessories','Accessories','Scarves and finishing layers.',3,true)
ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,
  sort_order=excluded.sort_order,updated_at=now();

-- Catalogue (descriptive fields sync; stock untouched on reseed) ------------
INSERT INTO products(id,sku,name,description,details,price_paise,image_url,stock,active,category_id) VALUES
 ('p-airmax','AIRMAX-90-UK9','Air Max Runner','Cushioned road-running shoe with a visible air unit and breathable mesh upper.','Engineered mesh upper · Foam midsole with visible air unit · Rubber waffle outsole · UK 9 · 289g',1299500,'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=80&auto=format&fit=crop',24,true,'c-footwear'),
 ('p-trail','TRAIL-GTX-UK9','Trail Hiking Shoes','Waterproof trail shoe built for loose rock and wet ground.','Waterproof membrane · 5mm lugged outsole · Reinforced toe cap · UK 9 · 412g',849900,'https://images.unsplash.com/photo-1520639888713-7851133b1ed0?w=800&q=80&auto=format&fit=crop',30,true,'c-footwear'),
 ('p-denim','DENIM-SLIM-32','Slim Denim Jeans','Mid-rise slim jeans in comfort stretch denim with a clean indigo finish.','98% cotton, 2% elastane · Five-pocket · Button fly · 32" waist, 32" inseam · Machine wash cold',329900,'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800&q=80&auto=format&fit=crop',50,true,'c-apparel'),
 ('p-aurora','AURORA-SCARF-180','Aurora Wool Scarf','Brushed lambswool-blend scarf, light enough to layer and warm enough for winter.','70% lambswool, 30% recycled polyamide · 180 x 32 cm · Hand-finished fringe · Dry clean only',249900,'https://images.unsplash.com/photo-1737056207688-acc991990309?w=800&q=80&auto=format&fit=crop',40,true,'c-accessories'),
 ('p-tee','TEE-CORE-WHT-M','Essential Cotton Tee','Heavyweight combed-cotton t-shirt with a clean regular fit that holds its shape.','100% combed cotton, 220 GSM · Regular fit · Ribbed collar · Size M · Machine wash warm',129900,'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80&auto=format&fit=crop',100,true,'c-apparel')
ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,name=excluded.name,
  description=excluded.description,details=excluded.details,
  price_paise=excluded.price_paise,image_url=excluded.image_url,
  active=true,updated_at=now();

-- Demo accounts (provisioned, never via signup) -----------------------------
INSERT INTO users(id,email,password_hash,full_name,role,warehouse_id,active,created_at) VALUES
 ('u-demo-customer','customer@returnos.test','$2a$10$zeN0N1f5ONonZMsvucUkFOsvtm3JNN2Us66QF0Nf7hSuRK2oAbGne','Demo Customer','CUSTOMER',NULL,true,now()-interval '60 days'),
 ('u-demo-maya','maya@example.com','$2a$10$gt6t7/aoyMe.wxntP50OyeB4uwclBGF1IRnV8lYYIMfjGDxCYJ8mO','Maya Sharma','CUSTOMER',NULL,true,now()-interval '60 days'),
 ('u-wh-operator','warehouse@returnos.test','$2a$10$ldN1mHute0CMgsrGcVK1VOlrDB9ckYRH56rAGIaacZYGuMeDDf4ma','Warehouse Operator','WAREHOUSE','wh-blr-01',true,now()-interval '60 days'),
 ('u-admin','admin@returnos.test','$2a$10$gECfb254c/5.RHCIQcumjeYqKpLBf23QT/MIcWhSp7IbehJ8I/re6','ReturnOS Admin','ADMIN',NULL,true,now()-interval '60 days')
ON CONFLICT(id) DO NOTHING;

INSERT INTO customer_profiles(user_id,phone,comm_prefs,notif_prefs) VALUES
 ('u-demo-customer','+919876543210','{"email":true,"sms":false}'::jsonb,'{"returns":true,"offers":false}'::jsonb),
 ('u-demo-maya','+919876543210','{"email":true,"sms":false}'::jsonb,'{"returns":true,"offers":false}'::jsonb)
ON CONFLICT(user_id) DO NOTHING;

INSERT INTO addresses(id,user_id,label,full_name,line1,line2,city,state,postal_code,country,phone,is_default) VALUES
 ('addr-u-demo-customer','u-demo-customer','HOME','Demo Customer','221 MG Road','Apartment 4B','Bengaluru','Karnataka','560001','IN','+919876543210',true),
 ('addr-u-demo-maya','u-demo-maya','HOME','Maya Sharma','221 MG Road','Apartment 4B','Bengaluru','Karnataka','560001','IN','+919876543210',true)
ON CONFLICT(id) DO NOTHING;

-- Available inventory mirrors catalogue stock (missing buckets only) --------
INSERT INTO inventory_buckets(warehouse_id,product_id,state,quantity,location_id)
SELECT 'wh-blr-01',p.id,'AVAILABLE',p.stock,'loc-wh-blr-01-stk-01' FROM products p
ON CONFLICT(warehouse_id,product_id,state) DO NOTHING;

-- Seeded orders for the demo customer ---------------------------------------
INSERT INTO orders(id,order_number,customer_id,status,subtotal_paise,shipping_paise,payment_status,payment_method,carrier,tracking_number,created_at,delivered_at) VALUES
 ('o-2026-1001','ORD-2026-1001','u-demo-customer','DELIVERED',589700,9900,'PAID','TEST','ReturnOS Logistics','TRK1001AAA',now()-interval '11 days',now()-interval '6 days'),
 ('o-2026-1002','ORD-2026-1002','u-demo-customer','DELIVERED',849900,9900,'PAID','TEST','ReturnOS Logistics','TRK1002AAA',now()-interval '25 days',now()-interval '20 days'),
 ('o-2026-1003','ORD-2026-1003','u-demo-customer','DELIVERED',1299500,9900,'PAID','TEST','ReturnOS Logistics','TRK1003AAA',now()-interval '50 days',now()-interval '45 days')
ON CONFLICT(id) DO NOTHING;

INSERT INTO order_items(id,order_id,product_id,sku,product_name,product_image_url,quantity,unit_price_paise,line_total_paise) VALUES
 ('oi-1001-a','o-2026-1001','p-tee','TEE-CORE-WHT-M','Essential Cotton Tee','https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80&auto=format&fit=crop',2,129900,259800),
 ('oi-1001-b','o-2026-1001','p-denim','DENIM-SLIM-32','Slim Denim Jeans','https://images.unsplash.com/photo-1542272604-787c3835535d?w=800&q=80&auto=format&fit=crop',1,329900,329900),
 ('oi-1002-a','o-2026-1002','p-trail','TRAIL-GTX-UK9','Trail Hiking Shoes','https://images.unsplash.com/photo-1520639888713-7851133b1ed0?w=800&q=80&auto=format&fit=crop',1,849900,849900),
 ('oi-1003-a','o-2026-1003','p-airmax','AIRMAX-90-UK9','Air Max Runner','https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=80&auto=format&fit=crop',1,1299500,1299500)
ON CONFLICT(id) DO NOTHING;

INSERT INTO order_events(id,order_id,status,description,created_at) VALUES
 ('oe-1001-p','o-2026-1001','PLACED','Order placed',now()-interval '11 days'),
 ('oe-1001-d','o-2026-1001','DELIVERED','Order delivered',now()-interval '6 days'),
 ('oe-1002-p','o-2026-1002','PLACED','Order placed',now()-interval '25 days'),
 ('oe-1002-d','o-2026-1002','DELIVERED','Order delivered',now()-interval '20 days'),
 ('oe-1003-p','o-2026-1003','PLACED','Order placed',now()-interval '50 days'),
 ('oe-1003-d','o-2026-1003','DELIVERED','Order delivered',now()-interval '45 days')
ON CONFLICT(id) DO NOTHING;

-- Seeded demo return (REQUESTED, walked by E2E through the floor flow) ------
INSERT INTO returns(id,return_number,order_id,customer_id,status,resolution_type,description,created_at,updated_at) VALUES
 ('r-2026-0841','RET-2026-0841','o-2026-1002','u-demo-customer','REQUESTED','REFUND','Sole stitching came apart after first use.',now()-interval '2 days',now()-interval '2 days')
ON CONFLICT(id) DO NOTHING;

INSERT INTO return_items(id,return_id,order_item_id,quantity,reason_code,description) VALUES
 ('ri-2026-0841-a','r-2026-0841','oi-1002-a',1,'DEFECTIVE','Stitching defect on the left shoe.')
ON CONFLICT(id) DO NOTHING;

INSERT INTO return_events(id,return_id,status,description,created_at) VALUES
 ('re-0841-1','r-2026-0841','REQUESTED','Return request created by the customer.',now()-interval '2 days')
ON CONFLICT(id) DO NOTHING;

INSERT INTO pickups(id,return_id,kind,address,date,time_window,carrier,tracking_number,status,created_at,updated_at) VALUES
 ('pk-0841','r-2026-0841','PICKUP','221 MG Road, Apartment 4B, Bengaluru 560001',(now()-interval '1 day')::date,'10:00-14:00','Delhivery','DLV88410231','SCHEDULED',now()-interval '2 days',now()-interval '2 days')
ON CONFLICT(id) DO NOTHING;

INSERT INTO refunds(id,return_id,kind,amount_paise,method,status,initiated_at) VALUES
 ('rf-0841','r-2026-0841','REFUND',849900,'ORIGINAL_METHOD','PENDING',now()-interval '1 day')
ON CONFLICT(id) DO NOTHING;

INSERT INTO return_counter(year,last_seq) VALUES ('2026',841)
ON CONFLICT(year) DO UPDATE SET last_seq=GREATEST(return_counter.last_seq,841);

INSERT INTO notifications(id,user_id,return_id,type,title,body,created_at)
SELECT 'nt-0841','u-demo-customer','r-2026-0841','RETURN_STATUS','Return request received','Return RET-2026-0841 was created and is awaiting review.',now()-interval '2 days'
WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id='u-demo-customer' AND return_id='r-2026-0841' AND type='RETURN_STATUS');
