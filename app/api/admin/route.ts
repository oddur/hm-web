import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { stripe } from '@/utils/stripe';
import { upsertProductRecord } from '@/utils/supabase-admin';
import { Database } from '@/types_db';
import { log } from 'next-axiom';
import { v4 as uuidv4 } from 'uuid';


export async function POST(req: Request) {

  // todo: add auth check
  const requestId = uuidv4();

  const body = await req.text();
  const action = JSON.parse(body).action;
  const supabase = createRouteHandlerClient<Database>({ cookies });

  log.info('Admin API called.', { action: action, requestId: requestId });

  switch (action) {
    case 'stripe-sync-products': {
      let products_updates = 0;
      let products_deletes = 0;
      log.info('Admin API: Syncing Stripe Products', { requestId: requestId });
      const listAllProducts = await stripe.products.list();
      if (listAllProducts.lastResponse.statusCode != 200) {
        log.error(`Error fetching products from Stripe.`, { statusCode: listAllProducts.lastResponse.statusCode, requestId: requestId });
        return;
      }

      // iterate over the product
      for (const product of listAllProducts.data) {
        log.info(`Upserting product ${product.id}`, { requestId: requestId, product: product.id  });
        // product does not exist, create it
        await upsertProductRecord(product);
        products_updates++;
      }

      const dbProducts = await supabase.from('products').select('*');
      if (dbProducts.error != null) {
        log.error(`Error fetching products from database`, { error: dbProducts.error, requestId: requestId });
        return;
      }

      for (const dbProduct of dbProducts.data) {
        // check if the dbProduct exists in Stripe
        if (listAllProducts.data.find(p => p.id == dbProduct.id) == null) {
          log.info(`Deleting product ${dbProduct.id}`, { requestId: requestId, product: dbProduct.id});
          // product does not exist, delete it
          const deletion = await supabase.from('products').delete().eq('id', dbProduct.id);
          if (deletion.error != null) {
            log.error(`Error deleting product.`, {
              productId: dbProduct.id,
              error: deletion.error,
              statusText: deletion.statusText,
              requestId: requestId,
            });
          }
          products_deletes++;
        }
      }
      return new Response(JSON.stringify({ products_updates, products_deletes, requestId }), { status: 200 });
    }
  }

  return new Response(JSON.stringify({ 'error': 'unknown action', requestId }), { status: 500 });

}