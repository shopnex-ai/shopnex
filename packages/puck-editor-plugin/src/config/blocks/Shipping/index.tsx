import React, { useState } from 'react';
import { ComponentConfig } from '@measured/puck';
import './styles.scss';

export interface ShippingProps {
  title?: string;
  storeAddress?: string;
  storeHours?: string;
  storeName?: string;
  countries?: Array<{
    label: string;
    value: string;
  }>;
  deliveryOptions?: Array<{
    title: string;
    description: string;
  }>;
}

const defaultDeliveryOptions = [
  { title: 'pick up from store', description: 'Free, tomorrow' },
  { title: 'delivery in city', description: 'Free, tomorrow' },
  { title: 'regional delivery', description: 'Via Russian Post or postal courier services. Sending to any country' }
];

const defaultCountries = [
  { label: 'Choose the country', value: '' },
  { label: 'Russia', value: 'RU' }
];

const ShippingComponent: React.FC<ShippingProps> = ({
  title = 'Shipping',
  storeAddress = 'St. Petersburg, Nevsky Prospect 28',
  storeHours = 'Daily 10:00–22:00',
  storeName = 'Store Name',
  countries = defaultCountries,
  deliveryOptions = defaultDeliveryOptions
}) => {
  const [activeOption, setActiveOption] = useState(0);

  return (
    <section className="shipping-section">
      <h2 className="shipping-title">{title}</h2>
      <div className="shipping-card">
        <div className="delivery-options">
          {deliveryOptions.map((option, index) => (
            <div key={index} className="delivery-option">
              <a 
                href="#"
                className={`delivery-link ${index === activeOption ? 'active' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  setActiveOption(index);
                }}
              >
                <div className="delivery-title">{option.title}</div>
                <div className="delivery-description">{option.description}</div>
              </a>
            </div>
          ))}
        </div>

        <div className="shipping-content">
          {activeOption === 0 && (
            <section className="store-pickup">
              <div className="pickup-info">
                <div className="map-placeholder">
                  <div className="map-error">
                    <div className="error-icon">📍</div>
                    <div className="error-title">Map View</div>
                    <div className="error-message">Store location map would appear here</div>
                  </div>
                </div>
                <div className="store-details">
                  <div className="store-name">{storeName}</div>
                  <div className="store-address">{storeAddress}</div>
                  <div className="store-hours">{storeHours}</div>
                </div>
              </div>
            </section>
          )}

          {activeOption === 1 && (
            <section className="city-delivery">
              <div className="address-form">
                <div className="form-row">
                  <div className="form-group street">
                    <label>
                      <div className="form-label required">Street</div>
                      <input type="text" className="form-input" />
                    </label>
                  </div>
                  <div className="form-group house">
                    <label>
                      <div className="form-label required">House</div>
                      <input type="text" className="form-input" />
                    </label>
                  </div>
                </div>

                <div className="form-row details">
                  <div className="form-group">
                    <label>
                      <div className="form-label">Building</div>
                      <input type="text" className="form-input" />
                    </label>
                  </div>
                  <div className="form-group">
                    <label>
                      <div className="form-label">Entrance</div>
                      <input type="text" className="form-input" />
                    </label>
                  </div>
                  <div className="form-group">
                    <label>
                      <div className="form-label">Floor</div>
                      <input type="text" className="form-input" />
                    </label>
                  </div>
                  <div className="form-group">
                    <label>
                      <div className="form-label">Apartment</div>
                      <input type="text" className="form-input" />
                    </label>
                  </div>
                </div>

                <div className="form-group full-width">
                  <label>
                    <div className="form-label">Comment</div>
                    <textarea 
                      className="form-textarea" 
                      rows={5} 
                      placeholder="Additional information: phone numbers or door phone code"
                    />
                  </label>
                </div>

                <div className="delivery-schedule">
                  <div className="schedule-label">Choose a convenient date and delivery interval</div>
                  <div className="schedule-selects">
                    <div className="form-group">
                      <select className="form-select">
                        <option>Tomorrow</option>
                        <option>25 May</option>
                        <option>26 May</option>
                        <option>27 May</option>
                        <option>28 May</option>
                        <option>29 May</option>
                        <option>30 May</option>
                        <option>1 June</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <select className="form-select">
                        <option>09:00 – 12:00</option>
                        <option>12:00 – 15:00</option>
                        <option>15:00 – 18:00</option>
                        <option>18:00 – 21:00</option>
                        <option>21:00 – 23:00</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeOption === 2 && (
            <section className="regional-delivery">
              <div className="address-form">
                <div className="form-group full-width">
                  <label>
                    <div className="form-label required">Country</div>
                    <select className="form-select">
                      {countries.map((country, index) => (
                        <option key={index} value={country.value}>
                          {country.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="form-row">
                  <div className="form-group city">
                    <label>
                      <div className="form-label required">City</div>
                      <input type="text" className="form-input" />
                    </label>
                  </div>
                  <div className="form-group postcode">
                    <label>
                      <div className="form-label required">Post Code</div>
                      <input type="text" className="form-input" />
                    </label>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group street">
                    <label>
                      <div className="form-label required">Street</div>
                      <input type="text" className="form-input" />
                    </label>
                  </div>
                  <div className="form-group house">
                    <label>
                      <div className="form-label required">House</div>
                      <input type="text" className="form-input" />
                    </label>
                  </div>
                </div>

                <div className="form-row details">
                  <div className="form-group">
                    <label>
                      <div className="form-label">Building</div>
                      <input type="text" className="form-input" />
                    </label>
                  </div>
                  <div className="form-group">
                    <label>
                      <div className="form-label">Entrance</div>
                      <input type="text" className="form-input" />
                    </label>
                  </div>
                  <div className="form-group">
                    <label>
                      <div className="form-label">Floor</div>
                      <input type="text" className="form-input" />
                    </label>
                  </div>
                  <div className="form-group">
                    <label>
                      <div className="form-label">Apartment</div>
                      <input type="text" className="form-input" />
                    </label>
                  </div>
                </div>

                <div className="form-group full-width">
                  <label>
                    <div className="form-label">Comment</div>
                    <textarea 
                      className="form-textarea" 
                      rows={5} 
                      placeholder="Additional information: phone numbers or door phone code"
                    />
                  </label>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </section>
  );
};

export const Shipping: ComponentConfig<ShippingProps> = {
  fields: {
    title: {
      type: 'text',
      label: 'Title'
    },
    storeName: {
      type: 'text',
      label: 'Store Name'
    },
    storeAddress: {
      type: 'text',
      label: 'Store Address'
    },
    storeHours: {
      type: 'text',
      label: 'Store Hours'
    },
    deliveryOptions: {
      type: 'array',
      label: 'Delivery Options',
      arrayFields: {
        title: {
          type: 'text',
          label: 'Title'
        },
        description: {
          type: 'text',
          label: 'Description'
        }
      },
      defaultItemProps: {
        title: 'New Option',
        description: 'Description'
      }
    },
    countries: {
      type: 'array',
      label: 'Countries',
      arrayFields: {
        label: {
          type: 'text',
          label: 'Country Name'
        },
        value: {
          type: 'text',
          label: 'Country Code'
        }
      },
      defaultItemProps: {
        label: 'Country',
        value: 'CODE'
      }
    }
  },
  render: (props) => <ShippingComponent {...props} />
};