// Major cities (public geography): [name, state, latitude, longitude].
export const CITIES = [
  ['Delhi', 'Delhi', 28.61, 77.21], ['Mumbai', 'Maharashtra', 19.08, 72.88], ['Kolkata', 'West Bengal', 22.57, 88.36],
  ['Chennai', 'Tamil Nadu', 13.08, 80.27], ['Bengaluru', 'Karnataka', 12.97, 77.59], ['Hyderabad', 'Telangana', 17.39, 78.49],
  ['Ahmedabad', 'Gujarat', 23.02, 72.57], ['Pune', 'Maharashtra', 18.52, 73.86], ['Surat', 'Gujarat', 21.17, 72.83],
  ['Jaipur', 'Rajasthan', 26.91, 75.79], ['Jodhpur', 'Rajasthan', 26.24, 73.02], ['Lucknow', 'Uttar Pradesh', 26.85, 80.95],
  ['Varanasi', 'Uttar Pradesh', 25.32, 82.97], ['Nagpur', 'Maharashtra', 21.15, 79.09], ['Indore', 'Madhya Pradesh', 22.72, 75.86],
  ['Bhopal', 'Madhya Pradesh', 23.26, 77.41], ['Raipur', 'Chhattisgarh', 21.25, 81.63], ['Ranchi', 'Jharkhand', 23.34, 85.31],
  ['Patna', 'Bihar', 25.59, 85.14], ['Bhubaneswar', 'Odisha', 20.30, 85.82], ['Visakhapatnam', 'Andhra Pradesh', 17.69, 83.22],
  ['Vijayawada', 'Andhra Pradesh', 16.51, 80.65], ['Puducherry', 'Puducherry', 11.94, 79.81], ['Madurai', 'Tamil Nadu', 9.93, 78.12],
  ['Coimbatore', 'Tamil Nadu', 11.02, 76.96], ['Kochi', 'Kerala', 9.93, 76.27], ['Thiruvananthapuram', 'Kerala', 8.52, 76.94],
  ['Mangaluru', 'Karnataka', 12.91, 74.86], ['Panaji', 'Goa', 15.49, 73.83], ['Chandigarh', 'Chandigarh', 30.73, 76.78],
  ['Amritsar', 'Punjab', 31.63, 74.87], ['Srinagar', 'Jammu and Kashmir', 34.08, 74.80], ['Dehradun', 'Uttarakhand', 30.32, 78.03],
  ['Guwahati', 'Assam', 26.14, 91.74], ['Shillong', 'Meghalaya', 25.58, 91.89], ['Imphal', 'Manipur', 24.82, 93.94],
  ['Agartala', 'Tripura', 23.83, 91.28], ['Port Blair', 'Andaman and Nicobar', 11.62, 92.73],
].map(([name, state, lat, lon]) => ({ name, state, lat, lon }));

/** Cities named from far away. */
export const MAJOR = new Set(['Delhi', 'Mumbai', 'Kolkata', 'Chennai', 'Bengaluru', 'Hyderabad', 'Ahmedabad']);
